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
import { createQuoteDraft, priceQuote } from "@clockwork/domain/core";
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

import type { PartnerRecord } from "./partner-data";
import type { PartnerQuoteContext, QuoteRoute } from "./resale-quote-model";

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
    action: z.literal("create"),
    payload: z
      .object({
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

interface StoredQuote {
  readonly kind: "demo_partner_quote";
  readonly aggregateId: string;
  readonly partnerAccountId: string;
  readonly record: PartnerRecord;
  readonly createdAt: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
}

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

function isStoredQuote(value: unknown): value is StoredQuote {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_quote" &&
    typeof value.aggregateId === "string" &&
    typeof value.partnerAccountId === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.record) &&
    typeof value.record.id === "string" &&
    isRecord(value.snapshot)
  );
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

function projectedPartnerQuote(quote: StoredQuote): PartnerRecord {
  const transfer = moneySchema.safeParse(quote.snapshot.total);
  const resale = moneySchema.safeParse(quote.snapshot.partnerResaleTotal);
  return {
    ...quote.record,
    ...(transfer.success && resale.success
      ? {
          quotePricing: {
            transferPrice: displayMoney(
              transfer.data.currency,
              transfer.data.minor,
            ),
            resalePrice: displayMoney(resale.data.currency, resale.data.minor),
          },
        }
      : {}),
  };
}

export function demoCreatedPartnerQuotes(
  state: DemoAdapterState,
  partnerAccountId: string,
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
    .map(projectedPartnerQuote);
}

export function demoPartnerQuoteRecord(
  state: DemoAdapterState,
  partnerAccountId: string,
  recordKey: string,
): PartnerRecord | undefined {
  const found = createdQuotes(state).find(
    (quote) =>
      quote.partnerAccountId === partnerAccountId &&
      (quote.record.id === recordKey ||
        quote.aggregateId === recordKey ||
        `quote-${quote.aggregateId}` === recordKey),
  );
  return found ? projectedPartnerQuote(found) : undefined;
}

export function demoPartnerQuoteContext(
  state: DemoAdapterState,
  partnerAccountId: string,
  partnerAccountName: string,
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
  return {
    partnerAccountId,
    partnerAccountName,
    route: relationship.route,
    offers,
    endClients: [
      { ...relationship.endClient, quoteCurrency: relationship.currency },
    ],
  };
}

function displayMoney(currency: string, minor: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
  }).format(Number(BigInt(minor)) / 100);
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
      title: "Partner quote refused",
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The quote is invalid"
          : "The demo could not record the partner quote.",
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
        "Partner quote authority is required",
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
        "A valid idempotency-key header is required",
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const requestHash = createHash("sha256")
      .update(request.method)
      .update("\0")
      .update(new URL(request.url).pathname)
      .update("\0")
      .update(bytes)
      .digest("hex");
    const command = commandSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
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
        "The quote does not match the acting partner relationship",
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
            "The idempotency key is already bound to another partner quote",
          );
        replayed = true;
        result = prior.response;
        return state;
      }
      if (state.projectionOverrides[`${quotePrefix}${command.id}`])
        throw new PartnerQuoteProblem(
          409,
          "PARTNER_QUOTE_EXISTS",
          "This partner quote already exists",
        );
      const book = currentDemoPriceBooks(state).find(
        (candidate) => candidate.id === command.payload.priceBookId,
      );
      if (!book)
        throw new PartnerQuoteProblem(
          422,
          "PRICE_BOOK_NOT_FOUND",
          "The selected price book is unavailable",
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
            : "The quote could not be priced",
        );
      }
      const snapshot = createQuoteDraft({
        id: command.id,
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
      const reference = `quote-${command.id}`;
      const line = command.payload.lines[0];
      if (!line) throw new Error("Partner quote line disappeared");
      const record: PartnerRecord = {
        id: reference,
        name: `${relationship.endClient.name} · ${line.sku}`,
        context: `${command.payload.route === "distributor" ? "Two-tier distributor" : "Resale"} · ${line.region} · ${line.quantity} TB · ${line.termMonths} months`,
        status: "draft",
        quotePricing: {
          transferPrice: displayMoney(
            priced.total.currency,
            priced.total.minor,
          ),
          resalePrice: displayMoney(
            command.payload.partnerResaleTotal.currency,
            command.payload.partnerResaleTotal.minor,
          ),
        },
        risk: priced.marginResult === "exception_required" ? "high" : "low",
        owner: "Partner commercial team",
        value: `${displayMoney(priced.total.currency, priced.total.minor)} transfer / ${displayMoney(command.payload.partnerResaleTotal.currency, command.payload.partnerResaleTotal.minor)} resale`,
        secondary: `Draft · expires ${new Date(command.payload.expiresAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}`,
        href: `/partner/quotes/${reference}` as Route,
        recordVersion: 1,
        recordKey: reference,
        allowedActions: ["edit", "issue"],
      };
      result = {
        record: {
          id: command.id,
          resource: "quotes",
          accountId: command.accountId,
          rowVersion: 1,
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
        projectionOverrides: {
          ...state.projectionOverrides,
          [`${quotePrefix}${command.id}`]: {
            version: 1,
            updatedAt: now,
            data: {
              kind: "demo_partner_quote",
              aggregateId: command.id,
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
    if (!result) throw new Error("Demo partner quote produced no result");
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
