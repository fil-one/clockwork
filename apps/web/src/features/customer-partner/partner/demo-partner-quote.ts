import {
  isStoredQuote,
  storedQuoteFacts,
  type StoredQuote,
  type StoredQuoteRecord,
} from "./demo-partner-quote-state";
export {
  isStoredQuote,
  type StoredQuote,
  type StoredQuoteRecord,
} from "./demo-partner-quote-state";
import type { DemoQuoteState } from "@/src/features/experience-server/demo-quote-flow";
import type { DemoOrderAcceptanceState } from "@/src/features/experience-server/demo-order-acceptance";
import "server-only";

import { createHash } from "node:crypto";
import type { Route } from "next";

import type { SessionClaims } from "@clockwork/api";
import {
  hasPermission,
  MoneySchema,
  QuantitySchema,
  uuidV7,
} from "@clockwork/contracts";
import {
  createQuoteDraft,
  priceQuote,
  reviseQuote,
  type QuoteSnapshot,
} from "@clockwork/domain/core";
import {
  demoText,
  resolveDemoText,
} from "@clockwork/testing/demo-localized-text";
import { demoAccountIds } from "@clockwork/testing/personas";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import {
  currentDemoPriceBooks,
  domainPriceBook,
} from "@/src/features/internal-ops/price-books/demo-price-books";

import { formatMoney } from "@/src/features/shared/format";

import type { PartnerMilestone, PartnerRecord } from "./partner-data";
import {
  partnerMilestoneText,
  partnerPositionText,
  partnerQuoteContextText,
  type PartnerReader,
} from "./partner-presentation";
import type { PartnerQuoteContext, QuoteRoute } from "./resale-quote-model";

/*
 * Problem `title` and `detail` strings in this file are English API text for
 * logs and API clients. Partner pages never show them; they word the outcome
 * from the problem `code` (partner-command-errors.ts).
 */
const quotePrefix = "demo-partner-quote:";
const receiptPrefix = "demo-partner-quote-receipt:";

const relationships: Readonly<
  Record<
    string,
    {
      readonly route: QuoteRoute;
      readonly tier?: string;
      readonly currency: "GBP" | "USD";
      readonly endClient: { readonly id: string; readonly name: string };
    }
  >
> = {
  [demoAccountIds.reseller]: {
    route: "resale",
    tier: "reseller",
    currency: "GBP",
    endClient: {
      id: demoAccountIds.resaleEndClient,
      name: "Aster House Media",
    },
  },
  [demoAccountIds.distributor]: {
    route: "distributor",
    tier: "distributor",
    currency: "GBP",
    endClient: { id: demoAccountIds.ukEndClient, name: "Cobalt Orchard GmbH" },
  },
  [demoAccountIds.referral]: {
    route: "referral",
    currency: "USD",
    endClient: { id: demoAccountIds.endClient, name: "Lumen Field Research" },
  },
};

const moneySchema = z
  .object({
    currency: z.enum(["GBP", "USD"]),
    minor: z.string().regex(/^\d+$/u),
  })
  .strict();
const commandSchema = z
  .object({
    id: z.uuid(),
    accountId: z.uuid(),
    action: z.enum(["create", "revise", "edit"]),
    expectedVersion: z.number().int().positive().optional(),
    payload: z
      .object({
        revisionId: z.uuid().optional(),
        priceBookId: z.uuid(),
        seriesId: z.uuid(),
        route: z.enum(["resale", "distributor"]),
        endClientAccountId: z.uuid(),
        partnerAccountId: z.uuid(),
        lines: z
          .array(
            z
              .object({
                lineId: z.uuid(),
                sku: z.string().trim().min(1),
                region: z.string().trim().min(1),
                quantity: QuantitySchema,
                termMonths: z.number().int().positive(),
              })
              .strict(),
          )
          .min(1),
        partnerResaleTotal: moneySchema,
        expiresAt: z.iso.datetime(),
      })
      .strict(),
  })
  .strict();

interface StoredReceipt {
  readonly kind: "demo_partner_quote_receipt";
  readonly requestHash: string;
  readonly response: Readonly<Record<string, unknown>>;
}

class PartnerQuoteProblem extends Error {
  public constructor(
    public readonly status: 403 | 409 | 422,
    public readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStoredReceipt(value: unknown): value is StoredReceipt {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_quote_receipt" &&
    typeof value.requestHash === "string" &&
    isRecord(value.response)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function createdQuotes(state: DemoAdapterState): StoredQuote[] {
  return Object.entries(state.projectionOverrides)
    .filter(([key]) => key.startsWith(quotePrefix))
    .map(([, override]): unknown => override.data)
    .filter(isStoredQuote);
}

/** Who works a demo partner quote; stands in for the partner's own team name. */
const quoteOwner = demoText({
  en: "Partner commercial team",
  es: "Equipo comercial del socio",
  fr: "Équipe commerciale du partenaire",
  de: "Vertriebsteam des Partners",
  ja: "パートナー営業チーム",
  pt: "Equipe comercial do parceiro",
  zh: "合作伙伴商务团队",
  ar: "الفريق التجاري للشريك",
});

const snapshotSchema = z.object({
  status: z.string(),
  revision: z.number().int().positive(),
  route: z.string(),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/u),
  total: moneySchema,
  partnerResaleTotal: moneySchema.optional(),
  lines: z
    .array(
      z.object({
        sku: z.string(),
        region: z.string(),
        quantity: z.string(),
        termMonths: z.number(),
      }),
    )
    .min(1),
});

/**
 * Prose a writer before the facts-only shape left in a stored record. Read
 * only where no fact can replace it: a withdrawal reason or a superseding
 * revision recorded before those facts had fields of their own.
 */
function legacyProse(
  record: StoredQuoteRecord,
  key: string,
): string | undefined {
  const value = (record as unknown as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * The quote's next milestone, from what happened to it. The ledger line an
 * English-only writer used to store is derived here instead, so a quote reads
 * in the language of whoever opens it.
 */
function quoteMilestone(
  quote: StoredQuote,
  snapshot: z.infer<typeof snapshotSchema>,
  state: DemoAdapterState,
): PartnerMilestone {
  if (quote.orderId) {
    const purchaseOrder = (state as DemoOrderAcceptanceState).createdOrders?.[
      quote.orderId
    ]?.poNumber;
    return purchaseOrder
      ? { kind: "supplyOrderAccepted", purchaseOrder }
      : { kind: "supplyOrderAccepted" };
  }
  const record = quote.record;
  if (record.status === "canceled") {
    const legacy = legacyProse(record, "secondary");
    const legacyRevision = /^Superseded by revision (\d+)$/u.exec(
      legacy ?? "",
    )?.[1];
    const superseded =
      record.supersededByRevision ??
      (legacyRevision ? Number(legacyRevision) : undefined);
    if (superseded) return { kind: "supersededBy", revision: superseded };
    if (snapshot.status === "superseded")
      return { kind: "supersededBy", revision: snapshot.revision + 1 };
    const reason =
      record.withdrawalReason ?? /^Withdrawn: (.+)$/su.exec(legacy ?? "")?.[1];
    if (reason) return { kind: "withdrawn", reason };
  }
  const decision = quote.clientResponse?.decision;
  if (decision === "request_order") return { kind: "clientRequestedOrder" };
  if (decision === "request_changes") return { kind: "clientRequestedChanges" };
  if (decision === "decline") return { kind: "clientDeclined" };
  const on = snapshot.expiresAt.slice(0, 10);
  return snapshot.status === "draft"
    ? { kind: "draftExpires", on }
    : { kind: "issuedExpires", on };
}

/**
 * A stored demo quote as one reader sees it. Everything shown is derived from
 * the snapshot's facts and the record's state here, at read time, so the same
 * stored quote renders in Portuguese for one reader and German for the next,
 * and state written by an earlier release reads the same way.
 */
function projectedPartnerQuote(
  quote: StoredQuote,
  state: DemoAdapterState,
  reader: PartnerReader,
): PartnerRecord {
  const { t, locale, formatting } = reader;
  const record = storedQuoteFacts(quote.record);
  const parsed = snapshotSchema.safeParse(quote.snapshot);
  const base: PartnerRecord = {
    ...record,
    owner: resolveDemoText(quoteOwner, locale),
    context: "",
    value: "",
    secondary: "",
    ...(quote.orderId ? { orderId: quote.orderId } : {}),
    ...(quote.clientResponse ? { clientResponse: quote.clientResponse } : {}),
    quoteCommand: {
      quoteId: quote.aggregateId,
      accountId: String(quote.snapshot.accountId),
      version: record.recordVersion ?? 1,
    },
  };
  if (!parsed.success) return base;
  const snapshot = parsed.data;
  const resale = snapshot.partnerResaleTotal;
  return {
    ...base,
    context: partnerQuoteContextText(
      snapshot.route === "distributor" ? "distributor" : "resale",
      snapshot.lines,
      t,
      formatting,
    ),
    value:
      resale && resale.currency === snapshot.total.currency
        ? partnerPositionText(
            {
              kind: "transferAndResale",
              currency: snapshot.total.currency,
              transferMinor: snapshot.total.minor,
              resaleMinor: resale.minor,
            },
            t,
            formatting,
          )
        : "",
    secondary: partnerMilestoneText(
      quoteMilestone(quote, snapshot, state),
      t,
      formatting,
    ),
    ...(resale
      ? {
          quotePricing: {
            transferPrice: formatMoney(
              snapshot.total.minor,
              snapshot.total.currency,
              formatting,
            ),
            resalePrice: formatMoney(resale.minor, resale.currency, formatting),
          },
        }
      : {}),
  };
}

export function demoCreatedPartnerQuotes(
  state: DemoAdapterState,
  partnerAccountId: string,
  reader: PartnerReader,
): readonly PartnerRecord[] {
  return createdQuotes(state)
    .filter((quote) => quote.partnerAccountId === partnerAccountId)
    .toSorted((left, right) =>
      left.createdAt < right.createdAt
        ? 1
        : left.createdAt > right.createdAt
          ? -1
          : 0,
    )
    .map((quote) => projectedPartnerQuote(quote, state, reader));
}

export function demoPartnerQuoteRecord(
  state: DemoAdapterState,
  partnerAccountId: string,
  recordKey: string,
  reader: PartnerReader,
): PartnerRecord | undefined {
  const found = createdQuotes(state).find(
    (quote) =>
      quote.partnerAccountId === partnerAccountId &&
      (quote.record.id === recordKey ||
        quote.aggregateId === recordKey ||
        `quote-${quote.aggregateId}` === recordKey),
  );
  return found ? projectedPartnerQuote(found, state, reader) : undefined;
}

export function demoPartnerQuoteContext(
  state: DemoAdapterState,
  partnerAccountId: string,
  partnerAccountName: string,
  reference?: string,
): PartnerQuoteContext | undefined {
  const relationship = relationships[partnerAccountId];
  if (!relationship) return undefined;
  const offers = currentDemoPriceBooks(state)
    .filter(
      (book) =>
        book.status === "active" && book.currency === relationship.currency,
    )
    .flatMap((book) =>
      book.rateCards
        .filter(
          (rate) =>
            !relationship.tier ||
            Boolean(rate.partnerTransferPrices[relationship.tier]),
        )
        .map((rate) => ({
          id: `${book.id}:${rate.sku}:${rate.region}`,
          name: `${rate.sku} · ${rate.region} · ${book.name} (${book.currency})`,
          priceBookId: book.id,
          sku: rate.sku,
          region: rate.region,
          currency: book.currency,
        })),
    );
  let revision: PartnerQuoteContext["revision"];
  if (reference) {
    const prior = createdQuotes(state).find(
      (quote) =>
        quote.partnerAccountId === partnerAccountId &&
        (quote.record.id === reference || quote.aggregateId === reference),
    );
    if (!prior) return undefined;
    const snapshot = prior.snapshot as unknown as QuoteSnapshot;
    if (
      prior.orderId ||
      !["draft", "issued", "expired", "rejected"].includes(snapshot.status)
    )
      return undefined;
    const mapped = snapshot.lines.map((line) => ({
      line,
      offer: offers.find(
        (offer) =>
          offer.priceBookId === snapshot.priceBook.id &&
          offer.sku === line.sku &&
          offer.region === line.region,
      ),
    }));
    if (
      !mapped.length ||
      mapped.some((item) => !item.offer) ||
      !snapshot.partnerResaleTotal
    )
      return undefined;
    const first = mapped[0];
    if (!first?.offer) return undefined;
    revision = {
      quoteId: snapshot.id,
      version: prior.record.recordVersion ?? 1,
      seriesId: snapshot.seriesId,
      action: snapshot.status === "draft" ? "edit" : "revise",
      initialDraft: {
        ...(snapshot.status === "draft"
          ? { expiresAt: snapshot.expiresAt }
          : {}),
        offerName: first.offer.name,
        capacity: first.line.quantity,
        termMonths: String(first.line.termMonths),
        endClientName: relationship.endClient.name,
        resalePrice: (Number(snapshot.partnerResaleTotal.minor) / 100).toFixed(
          2,
        ),
      },
      lines: mapped.slice(1).map(({ line, offer }) => {
        if (!offer) throw new Error("The original offer is unavailable."); // i18n-exempt: internal invariant, not rendered
        return {
          offerId: offer.id,
          capacity: line.quantity,
          termMonths: String(line.termMonths),
        };
      }),
    };
  }
  return {
    ...(revision ? { revision } : {}),
    partnerAccountId,
    partnerAccountName,
    route: relationship.route,
    offers,
    endClients: [
      { ...relationship.endClient, quoteCurrency: relationship.currency },
    ],
  };
}

function problem(requestId: string, error: unknown): Response {
  const known = error instanceof PartnerQuoteProblem;
  const validation =
    error instanceof z.ZodError || error instanceof SyntaxError;
  const status = known ? error.status : validation ? 422 : 500;
  const code = known
    ? error.code
    : validation
      ? "VALIDATION_FAILED"
      : "DEMO_PARTNER_QUOTE_FAILED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: "Partner quote refused", // i18n-exempt: API problem detail, not rendered
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The quote is invalid" // i18n-exempt: API problem detail, not rendered
          : "The demo could not record the partner quote.", // i18n-exempt: API problem detail, not rendered
      code,
      requestId,
      retryable: status >= 500,
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

export async function handleDemoPartnerQuoteCommand(
  request: Request,
  session: SessionClaims,
  input: { readonly store?: DemoAdapterStateStore; readonly now?: string } = {},
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    const partnerRole = session.roles.some(
      (role) => role === "partner_admin" || role === "partner_seller",
    );
    if (
      session.isInternalStaff ||
      !partnerRole ||
      !session.roles.some((role) => hasPermission(role, "partner:quote:write"))
    )
      throw new PartnerQuoteProblem(
        403,
        "PARTNER_QUOTE_AUTHORITY_FORBIDDEN",
        "Partner quote authority is required", // i18n-exempt: API problem detail, not rendered
      );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 255
    )
      throw new PartnerQuoteProblem(
        422,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid idempotency-key header is required", // i18n-exempt: API problem detail, not rendered
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const requestHash = createHash("sha256")
      .update(request.method)
      .update("\0")
      .update(new URL(request.url).pathname)
      .update("\0")
      .update(bytes)
      .digest("hex");
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      isRecord(body) &&
      ["prepare_artifact", "issue", "share", "cancel"].includes(
        String(body.action),
      )
    ) {
      const { handlePartnerLifecycle } =
        await import("./demo-partner-lifecycle");
      return await handlePartnerLifecycle(
        body,
        session,
        idempotencyKey,
        requestHash,
        input,
      );
    }
    const command = commandSchema.parse(body);
    const relationship = relationships[command.payload.partnerAccountId];
    const partnerTier = relationship?.tier;
    if (
      command.payload.partnerAccountId === command.accountId ||
      !session.accountIds.includes(command.payload.partnerAccountId) ||
      !relationship ||
      relationship.route !== command.payload.route ||
      relationship.endClient.id !== command.accountId ||
      relationship.endClient.id !== command.payload.endClientAccountId ||
      !partnerTier
    )
      throw new PartnerQuoteProblem(
        403,
        "PARTNER_QUOTE_SCOPE_FORBIDDEN",
        "The quote does not match the acting partner relationship", // i18n-exempt: API problem detail, not rendered
      );
    const store = input.store ?? configuredDemoStateStore();
    const now = input.now ?? new Date().toISOString();
    let result: Readonly<Record<string, unknown>> | undefined;
    let replayed = false;
    await store.update((state) => {
      const receiptKey = `${receiptPrefix}${digest(idempotencyKey)}`;
      const prior = state.projectionOverrides[receiptKey]?.data;
      if (isStoredReceipt(prior)) {
        if (prior.requestHash !== requestHash)
          throw new PartnerQuoteProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to another partner quote", // i18n-exempt: API problem detail, not rendered
          );
        replayed = true;
        result = prior.response;
        return state;
      }
      const existing =
        state.projectionOverrides[`${quotePrefix}${command.id}`]?.data;
      const previous = isStoredQuote(existing) ? existing : undefined;
      const targetId =
        command.action === "revise" ? command.payload.revisionId : command.id;
      if (!targetId)
        throw new PartnerQuoteProblem(
          422,
          "REVISION_REQUIRED",
          "A revision identity is required.", // i18n-exempt: API problem detail, not rendered
        );
      if (command.action !== "create") {
        if (
          !previous ||
          previous.partnerAccountId !== command.payload.partnerAccountId ||
          previous.snapshot.accountId !== command.accountId
        )
          throw new PartnerQuoteProblem(
            403,
            "PARTNER_QUOTE_SCOPE_FORBIDDEN",
            "This quote is outside your account.", // i18n-exempt: API problem detail, not rendered
          );
        if (previous.orderId)
          throw new PartnerQuoteProblem(
            422,
            "QUOTE_ACCEPTED",
            "An ordered quote cannot be edited or revised.", // i18n-exempt: API problem detail, not rendered
          );
        if (previous.record.recordVersion !== command.expectedVersion)
          throw new PartnerQuoteProblem(
            409,
            "VERSION_CONFLICT",
            "The quote changed. Reload before editing.", // i18n-exempt: API problem detail, not rendered
          );
        if (
          previous.snapshot.seriesId !== command.payload.seriesId ||
          (previous.snapshot.priceBook as { id?: string })?.id !==
            command.payload.priceBookId
        )
          throw new PartnerQuoteProblem(
            422,
            "REVISION_CONTEXT_CHANGED",
            "Keep this revision on its original series and price book.", // i18n-exempt: API problem detail, not rendered
          );
        if (command.action === "edit" && previous.snapshot.status !== "draft")
          throw new PartnerQuoteProblem(
            422,
            "QUOTE_IMMUTABLE",
            "Only a draft can be edited. Create a revision of an issued quote.", // i18n-exempt: API problem detail, not rendered
          );
      }
      if (
        command.action !== "edit" &&
        state.projectionOverrides[`${quotePrefix}${targetId}`]
      )
        throw new PartnerQuoteProblem(
          409,
          "PARTNER_QUOTE_EXISTS",
          "This partner quote already exists", // i18n-exempt: API problem detail, not rendered
        );
      const book = currentDemoPriceBooks(state).find(
        (candidate) => candidate.id === command.payload.priceBookId,
      );
      if (!book)
        throw new PartnerQuoteProblem(
          422,
          "PRICE_BOOK_NOT_FOUND",
          "The selected price book is unavailable", // i18n-exempt: API problem detail, not rendered
        );
      let priced: ReturnType<typeof priceQuote>;
      try {
        priced = priceQuote({
          book: domainPriceBook(book),
          lines: command.payload.lines,
          route: command.payload.route,
          partnerTier,
          partnerResaleTotal: MoneySchema.parse(
            command.payload.partnerResaleTotal,
          ),
          quotedAt: now,
        });
      } catch (error) {
        throw new PartnerQuoteProblem(
          422,
          "PRICING_REFUSED",
          error instanceof Error
            ? error.message
            : "The quote could not be priced", // i18n-exempt: API problem detail, not rendered
        );
      }
      let snapshot = createQuoteDraft({
        id: targetId,
        seriesId: command.payload.seriesId,
        accountId: command.accountId,
        endClientAccountId: command.payload.endClientAccountId,
        partnerAccountId: command.payload.partnerAccountId,
        priceBook: { id: book.id, version: book.version },
        route: command.payload.route,
        lines: priced.lines,
        total: priced.total,
        partnerResaleTotal: MoneySchema.parse(
          command.payload.partnerResaleTotal,
        ),
        marginResult: priced.marginResult,
        exceptionReasons: priced.exceptionReasons,
        expiresAt: command.payload.expiresAt,
        createdBy: session.userId,
        createdAt: now,
      });
      let priorUpdate: StoredQuote | undefined;
      if (previous && command.action === "revise") {
        let revised: ReturnType<typeof reviseQuote>;
        try {
          revised = reviseQuote(
            previous.snapshot as unknown as QuoteSnapshot,
            snapshot,
          );
        } catch (error) {
          throw new PartnerQuoteProblem(
            422,
            "REVISION_REFUSED",
            error instanceof Error
              ? error.message
              : "This quote cannot be revised.", // i18n-exempt: API problem detail, not rendered
          );
        }
        snapshot = revised.revision;
        priorUpdate = {
          ...previous,
          snapshot: revised.prior as unknown as Record<string, unknown>,
          record: {
            ...storedQuoteFacts(previous.record),
            status: "canceled",
            supersededByRevision: snapshot.revision,
            allowedActions: ["download"],
            recordVersion: (previous.record.recordVersion ?? 1) + 1,
          },
        };
      } else if (previous) {
        snapshot = {
          ...snapshot,
          revision: Number(previous.snapshot.revision),
          ...(typeof previous.snapshot.previousRevisionId === "string"
            ? { previousRevisionId: previous.snapshot.previousRevisionId }
            : {}),
        };
      }
      const version =
        command.action === "edit"
          ? (previous?.record.recordVersion ?? 1) + 1
          : 1;
      const reference = `quote-${targetId}`;
      const line = command.payload.lines[0];
      if (!line) throw new Error("Partner quote line disappeared"); // i18n-exempt: internal invariant, not rendered
      // Facts only. The ledger line, amounts and dates are derived from the
      // snapshot for each reader (`projectedPartnerQuote`); nothing rendered
      // in one reader's language is stored for the next.
      const record: StoredQuoteRecord = {
        id: reference,
        name: `${relationship.endClient.name} · ${line.sku}`,
        status: "draft",
        risk: priced.marginResult === "exception_required" ? "high" : "low",
        href: `/partner/quotes/${reference}` as Route,
        recordVersion: version,
        recordKey: reference,
        allowedActions: ["edit", "issue", "cancel"],
      };
      result = {
        record: {
          id: targetId,
          resource: "quotes",
          accountId: command.accountId,
          rowVersion: version,
          data: {
            status: snapshot.status,
            reference,
            total: snapshot.total,
            partnerResaleTotal: snapshot.partnerResaleTotal,
            marginResult: snapshot.marginResult,
          },
          createdAt: now,
          updatedAt: now,
        },
        auditEventId: uuidV7(),
        outboxMessageId: uuidV7(),
      };
      return {
        ...state,
        revision: state.revision + 1,
        ...(command.action === "edit"
          ? {
              commercialArtifactRequests: Object.fromEntries(
                Object.entries(
                  (state as DemoQuoteState).commercialArtifactRequests ?? {},
                ).filter(([, request]) => request.subjectId !== targetId),
              ),
            }
          : {}),
        projectionOverrides: {
          ...state.projectionOverrides,
          ...(priorUpdate
            ? {
                [`${quotePrefix}${command.id}`]: {
                  version: priorUpdate.record.recordVersion ?? 1,
                  updatedAt: now,
                  data: { ...priorUpdate },
                },
              }
            : {}),
          [`${quotePrefix}${targetId}`]: {
            version,
            updatedAt: now,
            data: {
              kind: "demo_partner_quote",
              aggregateId: targetId,
              partnerAccountId: command.payload.partnerAccountId,
              record,
              createdAt: now,
              snapshot,
            },
          },
          [receiptKey]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_quote_receipt",
              requestHash,
              response: result,
            },
          },
        },
      };
    });
    if (!result) throw new Error("Demo partner quote produced no result"); // i18n-exempt: internal invariant, not rendered
    return Response.json(result, {
      headers: {
        "cache-control": "private, no-store",
        "idempotency-replayed": String(replayed),
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return problem(requestId, error);
  }
}
