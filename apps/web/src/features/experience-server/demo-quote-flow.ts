import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";
import {
  commercialArtifactSourceHash,
  CommercialArtifactDefinitionSchema,
  type CommercialArtifactDefinition,
} from "@clockwork/db/core";
import {
  createQuoteDraft,
  issueQuote,
  reviseQuote,
  priceQuote,
  type QuoteSnapshot,
} from "@clockwork/domain/core";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import {
  currentDemoPriceBooks,
  domainPriceBook,
} from "@/src/features/internal-ops/price-books/demo-price-books";

import { demoPartyFor, demoUuid } from "./demo-artifact-catalog";
import type { DemoCommercialArtifactRequest } from "./demo-order-acceptance";
import { configuredDemoStateStore } from "./demo-state-store";
import { ExperienceProblem } from "./model";
import type { ArtifactRepresentation } from "./model";

export interface DemoQuoteLineCommand {
  readonly lineId?: string;
  readonly sku: string;
  readonly region: string;
  readonly quantity: string;
  readonly termMonths: number;
  readonly discountBps?: number;
}

export type DemoQuoteCommand =
  | {
      readonly action: "create" | "revise";
      readonly expectedVersion?: number;
      readonly revisionId?: string;
      readonly quoteId: string;
      readonly accountId: string;
      readonly priceBookId: string;
      readonly seriesId: string;
      readonly route: "direct";
      readonly lines: readonly DemoQuoteLineCommand[];
      readonly expiresAt: string;
    }
  | {
      readonly action: "prepare_artifact";
      readonly quoteId: string;
      readonly accountId: string;
      readonly expectedVersion: number;
      readonly audience: "end_client";
      readonly issuedAt: string;
      readonly retainUntil: string;
    }
  | {
      readonly action: "issue";
      readonly quoteId: string;
      readonly accountId: string;
      readonly expectedVersion: number;
      readonly artifactIssuedAt: string;
      readonly renderedDocumentId: string;
    };

export interface DemoCreatedQuote {
  readonly snapshot: QuoteSnapshot;
  readonly rowVersion: number;
  readonly displayNumber: string;
  readonly locale: "en-US";
  readonly paymentTermsDays: 30;
  readonly buyerDomain: string;
  readonly agreementId: string;
  readonly agreementVersion: number;
  readonly agreementEffectiveOn: string;
  readonly updatedAt: string;
}

export interface DemoQuoteCommercialArtifactRequest {
  readonly id: string;
  readonly documentId: string;
  readonly subjectType: "quote";
  readonly subjectId: string;
  readonly commercialAccountId: string;
  readonly audienceAccountId: string;
  readonly audience: "end_client" | "partner";
  readonly documentKind:
    "direct_quote" | "partner_transfer_quote" | "partner_resale_quote";
  readonly sourceHash: string;
  readonly definition: CommercialArtifactDefinition;
  readonly retainUntil: string;
  readonly requestedBy: string;
  readonly createdAt: string;
}

export interface DemoQuoteCommandResult {
  readonly rowVersion: number;
  readonly data: Readonly<Record<string, unknown>>;
  readonly auditEventId: string;
  readonly outboxEventId: string;
}

interface DemoQuoteCommandReceipt {
  readonly userId: string;
  readonly requestHash: string;
  readonly result: DemoQuoteCommandResult;
  readonly createdAt: string;
}

export interface DemoQuoteState extends DemoAdapterState {
  readonly createdQuotes?: Readonly<Record<string, DemoCreatedQuote>>;
  readonly commercialArtifactRequests?: Readonly<
    Record<
      string,
      DemoQuoteCommercialArtifactRequest | DemoCommercialArtifactRequest
    >
  >;
  readonly quoteCommandReceipts?: Readonly<
    Record<string, DemoQuoteCommandReceipt>
  >;
  readonly artifactDeliveries?: Readonly<
    Record<string, ArtifactRepresentation>
  >;
}

function receiptKey(userId: string, idempotencyKey: string): string {
  return createHash("sha256")
    .update(userId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex");
}

function artifactMoney(value: { currency: string; minor: string }) {
  if (
    value.currency !== "USD" &&
    value.currency !== "EUR" &&
    value.currency !== "GBP"
  )
    throw new Error(`DEMO_QUOTE_CURRENCY_UNSUPPORTED:${value.currency}`);
  return { currency: value.currency, minorUnits: value.minor };
}

function quoteArtifactDefinition(
  quote: QuoteSnapshot,
  issuedAt: string,
): { definition: CommercialArtifactDefinition; sourceHash: string } {
  const definition = CommercialArtifactDefinitionSchema.parse({
    kind: "direct_quote",
    displayDocumentId: `Q-${quote.id}-R${quote.revision}-end_client`,
    documentVersion: String(quote.revision),
    issuedAt,
    locale: "en-US",
    recipient: demoPartyFor(quote.accountId),
    issuerMode: "platform",
    quoteNumber: `Q-${quote.id}-R${quote.revision}`,
    validUntil: quote.expiresAt.slice(0, 10),
    currency: quote.total.currency,
    lineItems: quote.lines.map((line) => ({
      id: line.id,
      description: line.sku,
      detail: `${line.region}; contracted overage ${line.overageRate.minor} minor units`,
      quantity: line.quantity,
      unitLabel: line.unit,
      unitPrice: artifactMoney(line.unitPrice),
      amount: artifactMoney(line.lineTotal),
    })),
    totals: {
      subtotal: artifactMoney(quote.total),
      total: artifactMoney(quote.total),
    },
    purchaseOrderRequired: true,
    paymentTerms: "Net 30 days",
  });
  return { definition, sourceHash: commercialArtifactSourceHash(definition) };
}

function existingQuote(
  state: DemoQuoteState,
  command: Exclude<DemoQuoteCommand, { action: "create" | "revise" }>,
): DemoCreatedQuote {
  const quote = state.createdQuotes?.[command.quoteId];
  if (!quote)
    throw new ExperienceProblem(404, "NOT_FOUND", "Quote was not found");
  if (quote.snapshot.accountId !== command.accountId)
    throw new ExperienceProblem(
      403,
      "ACCOUNT_SCOPE_FORBIDDEN",
      "The quote belongs to another account",
    );
  if (quote.rowVersion !== command.expectedVersion)
    throw new ExperienceProblem(
      409,
      "VERSION_CONFLICT",
      "Quote version is stale",
    );
  return quote;
}

function transition(
  state: DemoQuoteState,
  session: SessionClaims,
  command: DemoQuoteCommand,
  now: Date,
): {
  state: DemoQuoteState;
  rowVersion: number;
  data: Record<string, unknown>;
} {
  const occurredAt = now.toISOString();
  if (command.action === "create" || command.action === "revise") {
    const previous =
      command.action === "revise"
        ? state.createdQuotes?.[command.quoteId]
        : undefined;
    if (
      command.action === "revise" &&
      (!previous || previous.snapshot.accountId !== command.accountId)
    )
      throw new ExperienceProblem(404, "NOT_FOUND", "Quote was not found");
    if (
      previous &&
      (previous.rowVersion !== command.expectedVersion ||
        previous.snapshot.seriesId !== command.seriesId ||
        previous.snapshot.priceBook.id !== command.priceBookId)
    )
      throw new ExperienceProblem(
        409,
        "VERSION_CONFLICT",
        "The revision must use the current quote version, series and price book",
      );
    if (
      previous &&
      state.projectionOverrides[command.quoteId]?.data.status === "accepted"
    )
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        "An accepted quote cannot be revised. Create a new quote for additional requirements.",
      );
    const newId =
      command.action === "revise" ? command.revisionId : command.quoteId;
    if (!newId)
      throw new ExperienceProblem(
        422,
        "INVALID_BODY",
        "A revision identifier is required",
      );
    const prior = state.createdQuotes?.[newId];
    if (prior)
      throw new ExperienceProblem(
        409,
        "QUOTE_ID_CONFLICT",
        "This quote identifier is already in use",
      );
    const book = currentDemoPriceBooks(state).find(
      (candidate) => candidate.id === command.priceBookId,
    );
    if (!book)
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        "The selected price book is unavailable",
      );
    let priced: ReturnType<typeof priceQuote>;
    try {
      priced = priceQuote({
        book: domainPriceBook(book),
        lines: command.lines,
        route: command.route,
        quotedAt: occurredAt,
      });
    } catch (error) {
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        error instanceof Error
          ? error.message
          : "The quote could not be priced",
      );
    }
    let snapshot = createQuoteDraft({
      id: newId,
      seriesId: command.seriesId,
      accountId: command.accountId,
      priceBook: { id: book.id, version: book.version },
      route: command.route,
      lines: priced.lines,
      total: priced.total,
      marginResult: priced.marginResult,
      exceptionReasons: priced.exceptionReasons,
      expiresAt: command.expiresAt,
      createdBy: session.userId,
      createdAt: occurredAt,
    });
    let superseded: DemoCreatedQuote | undefined;
    if (previous) {
      try {
        const revised = reviseQuote(previous.snapshot, snapshot);
        snapshot = revised.revision;
        superseded = {
          ...previous,
          snapshot: revised.prior,
          rowVersion: previous.rowVersion + 1,
          updatedAt: occurredAt,
        };
      } catch (error) {
        throw new ExperienceProblem(
          422,
          "INVALID_STATE",
          error instanceof Error ? error.message : "Quote cannot be revised",
        );
      }
    }
    const created: DemoCreatedQuote = {
      snapshot,
      rowVersion: 1,
      displayNumber: `Q-${snapshot.id}`,
      locale: "en-US",
      paymentTermsDays: 30,
      buyerDomain: "meridian-archive.test",
      agreementId: demoUuid("agreement:AGR-2026-0042"),
      agreementVersion: 3,
      agreementEffectiveOn: "2025-10-01",
      updatedAt: occurredAt,
    };
    return {
      state: {
        ...state,
        createdQuotes: {
          ...state.createdQuotes,
          ...(superseded ? { [superseded.snapshot.id]: superseded } : {}),
          [snapshot.id]: created,
        },
      },
      rowVersion: created.rowVersion,
      data: {
        status: snapshot.status,
        totalMinor: snapshot.total.minor,
        currency: snapshot.total.currency,
        marginFloorResult: snapshot.marginResult,
        expiresAt: snapshot.expiresAt,
      },
    };
  }

  const stored = existingQuote(
    state,
    command as Exclude<DemoQuoteCommand, { action: "create" | "revise" }>,
  );
  if (command.action === "prepare_artifact") {
    if (stored.snapshot.status !== "draft")
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        "Only a draft quote can prepare its document",
      );
    if (Date.parse(command.retainUntil) <= Date.parse(command.issuedAt))
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        "Commercial artifact retention must follow issuance",
      );
    const artifact = quoteArtifactDefinition(stored.snapshot, command.issuedAt);
    const id = demoUuid(
      `artifact-request:quote:${stored.snapshot.id}:direct_quote:${artifact.sourceHash}`,
    );
    const prior = state.commercialArtifactRequests?.[id];
    if (prior?.subjectType === "order")
      throw new Error("DEMO_QUOTE_ARTIFACT_ID_COLLISION");
    const request: DemoQuoteCommercialArtifactRequest = prior
      ? prior
      : {
          id,
          documentId: demoUuid(`direct-quote-document:${id}`),
          subjectType: "quote",
          subjectId: stored.snapshot.id,
          commercialAccountId: stored.snapshot.accountId,
          audienceAccountId: stored.snapshot.accountId,
          audience: "end_client",
          documentKind: "direct_quote",
          sourceHash: artifact.sourceHash,
          definition: artifact.definition,
          retainUntil: command.retainUntil,
          requestedBy: session.userId,
          createdAt: occurredAt,
        };
    return {
      state: {
        ...state,
        commercialArtifactRequests: {
          ...state.commercialArtifactRequests,
          [id]: request,
        },
      },
      rowVersion: stored.rowVersion,
      data: {
        status: stored.snapshot.status,
        artifactRequest: {
          requestId: request.id,
          documentId: request.documentId,
          sourceHash: request.sourceHash,
          retainUntil: request.retainUntil,
        },
      },
    };
  }

  if (command.action !== "issue")
    throw new ExperienceProblem(
      422,
      "ACTION_NOT_ALLOWED",
      "Invalid quote action",
    );
  const request = Object.values(state.commercialArtifactRequests ?? {}).find(
    (candidate): candidate is DemoQuoteCommercialArtifactRequest =>
      typeof candidate === "object" &&
      candidate !== null &&
      "subjectType" in candidate &&
      candidate.subjectType === "quote" &&
      "subjectId" in candidate &&
      candidate.subjectId === stored.snapshot.id &&
      "documentId" in candidate &&
      candidate.documentId === command.renderedDocumentId &&
      "documentKind" in candidate &&
      candidate.documentKind === "direct_quote",
  );
  if (!request)
    throw new ExperienceProblem(
      409,
      "COMMERCIAL_ARTIFACT_BINDING_INVALID",
      "The stored quote document does not match this quote",
    );
  const delivery = state.artifactDeliveries?.[request.id];
  if (
    !delivery ||
    delivery.kind !== "direct_quote" ||
    delivery.subjectType !== "quote" ||
    delivery.subjectId !== stored.snapshot.id ||
    delivery.accountId !== stored.snapshot.accountId ||
    delivery.documentId !== command.renderedDocumentId
  )
    throw new ExperienceProblem(
      409,
      "COMMERCIAL_ARTIFACT_BINDING_INVALID",
      "The quote document has not been rendered and stored for this quote",
    );
  const expected = quoteArtifactDefinition(
    stored.snapshot,
    command.artifactIssuedAt,
  );
  if (request.sourceHash !== expected.sourceHash)
    throw new ExperienceProblem(
      409,
      "COMMERCIAL_ARTIFACT_BINDING_INVALID",
      "The stored quote document does not match this quote",
    );
  let issued: QuoteSnapshot;
  try {
    issued = issueQuote(stored.snapshot, {
      issuedAt: command.artifactIssuedAt,
      renderedDocumentId: command.renderedDocumentId,
    });
  } catch (error) {
    throw new ExperienceProblem(
      422,
      "INVALID_STATE",
      error instanceof Error ? error.message : "The quote could not be issued",
    );
  }
  const updated: DemoCreatedQuote = {
    ...stored,
    snapshot: issued,
    rowVersion: stored.rowVersion + 1,
    updatedAt: occurredAt,
  };
  return {
    state: {
      ...state,
      createdQuotes: { ...state.createdQuotes, [issued.id]: updated },
    },
    rowVersion: updated.rowVersion,
    data: {
      status: issued.status,
      totalMinor: issued.total.minor,
      currency: issued.total.currency,
      marginFloorResult: issued.marginResult,
      renderedDocumentId: issued.renderedDocumentId,
      issuedAt: issued.issuedAt,
    },
  };
}

export class DemoQuoteFlow {
  public constructor(
    private readonly store: DemoAdapterStateStore = configuredDemoStateStore(),
  ) {}

  public async execute(input: {
    readonly session: SessionClaims;
    readonly command: DemoQuoteCommand;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly now?: Date;
  }): Promise<{ result: DemoQuoteCommandResult; replayed: boolean }> {
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 255)
      throw new ExperienceProblem(
        422,
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key must be between 16 and 255 characters",
      );
    if (!/^[a-f0-9]{64}$/u.test(input.requestHash))
      throw new Error("DEMO_QUOTE_REQUEST_HASH_INVALID");
    const key = receiptKey(input.session.userId, input.idempotencyKey);
    const now = input.now ?? new Date();
    const candidateAuditEventId = uuidV7();
    const candidateOutboxEventId = uuidV7();
    const committed = (await this.store.update((current) => {
      const state = current as DemoQuoteState;
      const existing = state.quoteCommandReceipts?.[key];
      if (existing) {
        if (
          existing.userId !== input.session.userId ||
          existing.requestHash !== input.requestHash
        )
          throw new ExperienceProblem(
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "The idempotency key was already used for a different request",
          );
        return state;
      }
      const changed = transition(state, input.session, input.command, now);
      const result: DemoQuoteCommandResult = {
        rowVersion: changed.rowVersion,
        data: changed.data,
        auditEventId: candidateAuditEventId,
        outboxEventId: candidateOutboxEventId,
      };
      return {
        ...changed.state,
        revision: state.revision + 1,
        quoteCommandReceipts: {
          ...state.quoteCommandReceipts,
          [key]: {
            userId: input.session.userId,
            requestHash: input.requestHash,
            result,
            createdAt: now.toISOString(),
          },
        },
      } satisfies DemoQuoteState;
    })) as DemoQuoteState;
    const receipt = committed.quoteCommandReceipts?.[key];
    if (!receipt) throw new Error("DEMO_QUOTE_COMMAND_RECEIPT_MISSING");
    return {
      result: receipt.result,
      replayed: receipt.result.auditEventId !== candidateAuditEventId,
    };
  }

  public async createdQuotes(): Promise<readonly DemoCreatedQuote[]> {
    return Object.values(
      ((await this.store.read()) as DemoQuoteState).createdQuotes ?? {},
    );
  }
}

let flow: DemoQuoteFlow | undefined;

export function demoQuoteFlow(): DemoQuoteFlow {
  flow ??= new DemoQuoteFlow();
  return flow;
}
