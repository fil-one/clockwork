import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, MoneySchema, uuidV7 } from "@clockwork/contracts";
import { validatePriceBook } from "@clockwork/domain/core";
import { DEMO_NOW } from "@clockwork/testing/demo-seed";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";

import {
  currentDemoPriceBooks,
  demoPriceBookReceiptPrefix,
  domainPriceBook,
  storeDemoPriceBooks,
  type DemoPriceBook,
} from "./demo-price-books";

const commandSchema = z
  .object({
    id: z.uuid(),
    action: z.enum([
      "create",
      "add_rate",
      "request_activation",
      "activate",
      "retire",
    ]),
    expectedVersion: z.number().int().positive().optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const createSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    currency: z.enum(["EUR", "GBP", "USD"]),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
    version: z.number().int().positive(),
  })
  .strict();

const quantity = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/u);
const rateSchema = z
  .object({
    id: z.uuid().optional(),
    sku: z.string().trim().min(1).max(80),
    region: z.string().trim().min(1).max(80),
    unit: z.string().trim().min(1).max(40),
    approvedClaim: z.string().trim().min(1).max(500),
    unitPrice: MoneySchema,
    floorPrice: MoneySchema.optional(),
    overageRate: MoneySchema,
    minimumQuantity: quantity,
    trialLimit: quantity.optional(),
    egressTreatment: z.string().trim().min(1).max(40),
    commitType: z.enum(["period_allowance", "term_drawdown"]),
    stripeTaxCode: z.string().trim().min(1).max(80),
    qboIncomeAccount: z.string().trim().min(1).max(120),
    partnerTransferPrices: z.record(z.string(), MoneySchema).default({}),
  })
  .strict();

const decisionSchema = z
  .object({ reason: z.string().trim().min(8).max(1_000) })
  .strict();

class DemoPriceBookProblem extends Error {
  public constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly code: string,
    detail: string,
  ) {
    super(detail);
  }
}

interface StoredReceipt {
  readonly kind: "demo_price_book_receipt";
  readonly requestHash: string;
  readonly response: Readonly<Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function receipt(
  state: DemoAdapterState,
  key: string,
): StoredReceipt | undefined {
  const data =
    state.projectionOverrides[`${demoPriceBookReceiptPrefix}${key}`]?.data;
  if (!isRecord(data) || data.kind !== "demo_price_book_receipt")
    return undefined;
  if (typeof data.requestHash !== "string" || !isRecord(data.response))
    throw new Error("Demo price-book receipt is invalid");
  return data as unknown as StoredReceipt;
}

function withReceipt(
  state: DemoAdapterState,
  key: string,
  requestHash: string,
  response: Readonly<Record<string, unknown>>,
  updatedAt: string,
): DemoAdapterState {
  return {
    ...state,
    projectionOverrides: {
      ...state.projectionOverrides,
      [`${demoPriceBookReceiptPrefix}${key}`]: {
        version: 1,
        updatedAt,
        data: { kind: "demo_price_book_receipt", requestHash, response },
      },
    },
  };
}

function responseFor(
  book: DemoPriceBook,
  action: string,
  now: string,
  auditEventId: string,
  outboxMessageId: string,
) {
  return {
    record: {
      id: book.id,
      resource: "price_books",
      rowVersion: book.rowVersion,
      data: {
        name: book.name,
        currency: book.currency,
        version: book.version,
        status: book.status,
        statusAction: action,
        rateCardCount: book.rateCardCount,
      },
      createdAt: now,
      updatedAt: now,
    },
    auditEventId,
    outboxMessageId,
  } as const;
}

function requiredBook(
  books: readonly DemoPriceBook[],
  id: string,
): DemoPriceBook {
  const book = books.find((candidate) => candidate.id === id);
  if (!book)
    throw new DemoPriceBookProblem(
      404,
      "NOT_FOUND",
      "Price book was not found",
    );
  return book;
}

function checkVersion(book: DemoPriceBook, expected: number | undefined) {
  if (expected !== book.rowVersion)
    throw new DemoPriceBookProblem(
      409,
      "VERSION_CONFLICT",
      "Price book changed since it was read",
    );
}

function mutateBooks(input: {
  readonly action: z.infer<typeof commandSchema>["action"];
  readonly actorId: string;
  readonly id: string;
  readonly expectedVersion: number | undefined;
  readonly payload: Record<string, unknown>;
  readonly books: DemoPriceBook[];
  readonly now: string;
}): DemoPriceBook {
  if (input.action === "create") {
    const payload = createSchema.parse(input.payload);
    if (payload.effectiveTo && payload.effectiveTo < payload.effectiveFrom)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "Price book end date precedes its start date",
      );
    if (
      input.books.some(
        (book) =>
          book.id === input.id ||
          (book.currency === payload.currency &&
            book.version === payload.version),
      )
    )
      throw new DemoPriceBookProblem(
        409,
        "DUPLICATE",
        "Price book currency and version already exist",
      );
    const created: DemoPriceBook = {
      id: input.id,
      ...payload,
      effectiveTo: payload.effectiveTo ?? null,
      rowVersion: 1,
      status: "draft",
      rateCardCount: 0,
      regions: [],
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      activationRequestedAt: null,
      lastDecisionAt: null,
      lastDecisionReason: null,
      rateCards: [],
    };
    input.books.push(created);
    return created;
  }

  const current = requiredBook(input.books, input.id);
  checkVersion(current, input.expectedVersion);
  const index = input.books.findIndex((book) => book.id === current.id);
  if (input.action === "add_rate") {
    if (current.status !== "draft")
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "Rate cards may only be added to a draft price book",
      );
    const parsed = rateSchema.parse(input.payload);
    const { floorPrice, trialLimit, ...required } = parsed;
    const rate = {
      ...required,
      id: parsed.id ?? uuidV7(),
      ...(floorPrice ? { floorPrice } : {}),
      ...(trialLimit ? { trialLimit } : {}),
    };
    const next = {
      ...current,
      rowVersion: current.rowVersion + 1,
      rateCards: [...current.rateCards, rate],
      rateCardCount: current.rateCardCount + 1,
      regions: [...new Set([...current.regions, rate.region])].sort(),
    } satisfies DemoPriceBook;
    try {
      validatePriceBook(domainPriceBook(next));
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        error instanceof Error ? error.message : "Rate card is invalid",
      );
    }
    input.books[index] = next;
    return next;
  }

  const { reason } = decisionSchema.parse(input.payload);
  if (input.action === "request_activation") {
    if (current.status !== "draft" || current.activationRequestedBy)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "Only an unproposed draft can be proposed for activation",
      );
    try {
      validatePriceBook(domainPriceBook(current));
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        error instanceof Error ? error.message : "Price book is invalid",
      );
    }
    const next = {
      ...current,
      rowVersion: current.rowVersion + 1,
      activationRequestedBy: input.actorId,
      activationRequestedByEmail: "finance.approver@filone.test",
      activationRequestedAt: input.now,
      lastDecisionAt: input.now,
      lastDecisionReason: reason,
    } satisfies DemoPriceBook;
    input.books[index] = next;
    return next;
  }
  if (input.action === "activate") {
    if (
      current.status !== "draft" ||
      !current.activationRequestedBy ||
      current.activationRequestedBy === input.actorId
    )
      throw new DemoPriceBookProblem(
        422,
        "TWO_AUTHORITY_REQUIRED",
        "A different finance approver must activate the proposed draft",
      );
    try {
      validatePriceBook(domainPriceBook(current));
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        error instanceof Error ? error.message : "Price book is invalid",
      );
    }
    const occurredOn = input.now.slice(0, 10);
    if (current.effectiveFrom > occurredOn)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "A price book cannot activate before its effective date",
      );
    for (const [otherIndex, other] of input.books.entries())
      if (other.currency === current.currency && other.status === "active")
        input.books[otherIndex] = {
          ...other,
          rowVersion: other.rowVersion + 1,
          status: "retired",
          effectiveTo: occurredOn,
          lastDecisionAt: input.now,
          lastDecisionReason: reason,
        };
    const next = {
      ...current,
      rowVersion: current.rowVersion + 1,
      status: "active",
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      activationRequestedAt: null,
      lastDecisionAt: input.now,
      lastDecisionReason: reason,
    } satisfies DemoPriceBook;
    input.books[index] = next;
    return next;
  }
  if (current.status !== "active")
    throw new DemoPriceBookProblem(
      422,
      "INVALID_STATE",
      "Only an active price book can be retired",
    );
  const next = {
    ...current,
    rowVersion: current.rowVersion + 1,
    status: "retired",
    effectiveTo: input.now.slice(0, 10),
    lastDecisionAt: input.now,
    lastDecisionReason: reason,
  } satisfies DemoPriceBook;
  input.books[index] = next;
  return next;
}

function problem(requestId: string, error: unknown): Response {
  const known = error instanceof DemoPriceBookProblem;
  const validation =
    error instanceof z.ZodError || error instanceof SyntaxError;
  const status = known ? error.status : validation ? 422 : 500;
  const code = known
    ? error.code
    : validation
      ? "VALIDATION_FAILED"
      : "DEMO_PRICE_BOOK_FAILED";
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title: "Price-book command refused",
      status,
      detail:
        known || validation
          ? error instanceof Error
            ? error.message
            : "The command is invalid"
          : "The demo could not record the price-book command.",
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

export async function handleDemoPriceBookCommand(
  request: Request,
  session: SessionClaims,
  input: { readonly store?: DemoAdapterStateStore; readonly now?: string } = {},
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    if (
      !session.isInternalStaff ||
      !session.roles.some((role) => hasPermission(role, "quote:approve")) ||
      !session.mfaVerified ||
      !session.recentAuthenticationVerified
    )
      throw new DemoPriceBookProblem(
        403,
        "PRICE_BOOK_AUTHORITY_FORBIDDEN",
        "Finance approval with recent MFA is required",
      );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      !idempotencyKey ||
      idempotencyKey.length < 16 ||
      idempotencyKey.length > 255
    )
      throw new DemoPriceBookProblem(
        422,
        "IDEMPOTENCY_KEY_REQUIRED",
        "A valid idempotency-key header is required",
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    const requestHash = createHash("sha256")
      .update(request.method)
      .update(new URL(request.url).pathname)
      .update(bytes)
      .digest("hex");
    const command = commandSchema.parse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    const now = input.now ?? DEMO_NOW;
    const auditEventId = uuidV7();
    const outboxMessageId = uuidV7();
    let result: Readonly<Record<string, unknown>> | undefined;
    let replayed = false;
    await (input.store ?? configuredDemoStateStore()).update((state) => {
      const priorReceipt = receipt(state, idempotencyKey);
      if (priorReceipt) {
        if (priorReceipt.requestHash !== requestHash)
          throw new DemoPriceBookProblem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to another command",
          );
        replayed = true;
        result = priorReceipt.response;
        return state;
      }
      const books = currentDemoPriceBooks(state);
      const changed = mutateBooks({
        action: command.action,
        actorId: session.userId,
        id: command.id,
        expectedVersion: command.expectedVersion,
        payload: command.payload,
        books,
        now,
      });
      result = responseFor(
        changed,
        command.action,
        now,
        auditEventId,
        outboxMessageId,
      );
      return withReceipt(
        storeDemoPriceBooks(state, books, now),
        idempotencyKey,
        requestHash,
        result,
        now,
      );
    });
    if (!result) throw new Error("Demo price-book command produced no result");
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
