import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, MoneySchema, uuidV7 } from "@clockwork/contracts";
import {
  validatePriceBook,
  PriceBookCloneCommandSchema,
  PriceBookImportCommandSchema,
  parsePriceBookExchange,
  importedPriceBook,
  clonedDiscountMatrix,
  type DiscountMatrix,
} from "@clockwork/domain/core";
import { DEMO_NOW } from "@clockwork/testing/demo-seed";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { z } from "zod";

import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import type { MessageId, MessageValues, Translator } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";

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
      "clone",
      "import",
      "add_rate",
      "update_rate",
      "remove_rate",
      "update_discount_matrix",
      "reject_activation",
      "schedule_activation",
      "cancel_schedule",
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

const discountMatrixSchema = z
  .object({
    id: z.string().trim().min(1),
    version: z.number().int().min(0),
    defaultMaxDiscountBps: z.number().int().min(0).max(10000),
    rules: z.array(
      z
        .object({
          id: z.string().trim().min(1),
          sku: z.string().trim().min(1).optional(),
          region: z.string().trim().min(1).optional(),
          route: z
            .enum([
              "direct",
              "referral",
              "resale",
              "distributor",
              "marketplace",
            ])
            .optional(),
          partnerTier: z.string().trim().min(1).optional(),
          minTermMonths: z.number().int().positive().optional(),
          minQuantity: quantity.optional(),
          maxDiscountBps: z.number().int().min(0).max(10000),
        })
        .strict(),
    ),
  })
  .strict();

const decisionSchema = z
  .object({ reason: z.string().trim().min(8).max(1_000) })
  .strict();

/**
 * A refusal, carried as a message ID rather than a sentence so `problem()` can
 * word its `detail` in the language of the request that caused it. The price
 * book surfaces do not show that detail: like the core API's English one, it
 * is for API callers, and the surfaces word a refusal from its status class
 * and problem code (`price-book-presentation.tsx`).
 */
class DemoPriceBookProblem extends Error {
  public constructor(
    public readonly status: 403 | 404 | 409 | 422,
    public readonly code: string,
    public readonly detailId: MessageId,
    public readonly values: MessageValues = {},
  ) {
    super(detailId);
  }
}

/**
 * Validation messages from the domain package are English domain text; they
 * are quoted inside a translated sentence because they name the rule that
 * failed.
 */
function domainDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    // i18n-exempt: internal invariant; surfaces as the translated 500 detail, never as this text
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
        ...(book.importProvenance
          ? { importProvenance: book.importProvenance }
          : {}),
        ...(book.cloneProvenance
          ? { cloneProvenance: book.cloneProvenance }
          : {}),
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
      "adminPricing.command.notFound",
    );
  return book;
}

function checkVersion(book: DemoPriceBook, expected: number | undefined) {
  if (expected !== book.rowVersion)
    throw new DemoPriceBookProblem(
      409,
      "VERSION_CONFLICT",
      "adminPricing.command.versionConflict",
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
  if (input.action === "import") {
    let document: ReturnType<typeof parsePriceBookExchange>;
    try {
      document = parsePriceBookExchange(input.payload.document);
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.importInvalid",
        { detail: domainDetail(error) },
      );
    }
    const command = PriceBookImportCommandSchema.parse({
      ...input.payload,
      document,
    });
    if (
      input.books.some(
        (book) =>
          book.id === input.id ||
          (book.currency === document.currency &&
            book.version === command.version),
      )
    )
      throw new DemoPriceBookProblem(
        409,
        "DUPLICATE",
        "adminPricing.command.duplicate",
      );
    if (input.id === document.source.id)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.importIdentity",
      );
    const candidate = importedPriceBook(
      document,
      {
        id: input.id,
        name: command.name,
        version: command.version,
        effectiveFrom: command.effectiveFrom,
      },
      uuidV7,
    );
    const copied: DemoPriceBook = {
      ...candidate,
      rowVersion: 1,
      effectiveTo: null,
      rateCardCount: candidate.rateCards.length,
      regions: [
        ...new Set(candidate.rateCards.map((rate) => rate.region)),
      ].sort(),
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      activationRequestedAt: null,
      lastDecisionAt: null,
      lastDecisionReason: null,
      importProvenance: {
        document,
        documentHashKind: "normalized_validated_economics_sha256",
        documentHash: createHash("sha256")
          .update(JSON.stringify(document))
          .digest("hex"),
        source: document.source,
        sourceAuthority: "unverified_uploaded_economics",
        rateIdMap: candidate.rateCards.map((rate, index) => ({
          sourceRateId: document.rateCards[index]?.id,
          rateId: rate.id,
        })),
        providerMappings: "not_imported_requires_review",
        approvalHistory: "not_imported",
        reason: command.reason,
        actorId: input.actorId,
      },
    };
    input.books.push(copied);
    return copied;
  }
  if (input.action === "clone") {
    const payload = PriceBookCloneCommandSchema.parse(input.payload);
    const source = requiredBook(input.books, payload.sourceId);
    checkVersion(source, payload.sourceRowVersion);
    if (
      input.books.some(
        (book) =>
          book.id === input.id ||
          (book.currency === source.currency &&
            book.version === payload.version),
      )
    )
      throw new DemoPriceBookProblem(
        409,
        "DUPLICATE",
        "adminPricing.command.duplicate",
      );
    if (!source.rateCards.length)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.cloneEmpty",
      );
    const rateIdMap = source.rateCards.map((rate) => ({
      sourceRateId: rate.id,
      rateId: uuidV7(),
    }));
    const sourceWithoutSchedule = structuredClone(source);
    delete sourceWithoutSchedule.activationSchedule;
    const copied: DemoPriceBook = {
      ...structuredClone(sourceWithoutSchedule),
      id: input.id,
      name: payload.name,
      version: payload.version,
      rowVersion: 1,
      status: "draft",
      effectiveFrom: payload.effectiveFrom,
      effectiveTo: null,
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      activationRequestedAt: null,
      lastDecisionAt: null,
      lastDecisionReason: null,
      ...(source.discountMatrix
        ? {
            discountMatrix: clonedDiscountMatrix(
              source.discountMatrix,
              input.id,
            ),
          }
        : {}),
      rateCards: source.rateCards.map((rate, index) => {
        const mapping = rateIdMap[index];
        // i18n-exempt: internal invariant; surfaces as the translated 500 detail, never as this text
        if (!mapping) throw new Error("Cloned rate identity is missing");
        return { ...structuredClone(rate), id: mapping.rateId };
      }),
      cloneProvenance: {
        sourceId: source.id,
        sourceRowVersion: source.rowVersion,
        sourceVersion: source.version,
        rateIdMap,
        sourceSnapshot: structuredClone(domainPriceBook(source)),
        providerMappings: "not_copied_requires_review",
        reason: payload.reason,
        actorId: input.actorId,
      },
    };
    validatePriceBook(domainPriceBook(copied));
    input.books.push(copied);
    return copied;
  }
  if (input.action === "create") {
    const payload = createSchema.parse(input.payload);
    if (payload.effectiveTo && payload.effectiveTo < payload.effectiveFrom)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.endBeforeStart",
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
        "adminPricing.command.duplicate",
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
  if (input.action === "cancel_schedule") {
    const { reason } = decisionSchema.parse(input.payload);
    if (current.activationSchedule?.status !== "approved")
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.noSchedule",
      );
    const next: DemoPriceBook = {
      ...current,
      rowVersion: current.rowVersion + 1,
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      activationRequestedAt: null,
      lastDecisionAt: input.now,
      lastDecisionReason: reason,
      activationSchedule: {
        ...current.activationSchedule,
        status: "cancelled",
        completedAt: input.now,
        completionReason: reason,
      },
    };
    input.books[index] = next;
    return next;
  }
  if (current.activationSchedule?.status === "approved")
    throw new DemoPriceBookProblem(
      422,
      "INVALID_STATE",
      "adminPricing.command.scheduleFrozen",
    );
  if (input.action === "schedule_activation") {
    const { reason } = decisionSchema.parse(input.payload);
    if (
      current.status !== "draft" ||
      !current.activationRequestedBy ||
      current.activationRequestedBy === input.actorId
    )
      throw new DemoPriceBookProblem(
        422,
        "TWO_AUTHORITY_REQUIRED",
        "adminPricing.command.scheduleDistinct",
      );
    if (current.effectiveFrom <= input.now.slice(0, 10))
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.scheduleFuture",
      );
    if (
      input.books.some(
        (book) =>
          book.currency === current.currency &&
          book.activationSchedule?.status === "approved",
      )
    )
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.scheduleExists",
      );
    validatePriceBook(domainPriceBook(current));
    const next: DemoPriceBook = {
      ...current,
      rowVersion: current.rowVersion + 1,
      lastDecisionAt: input.now,
      lastDecisionReason: reason,
      activationSchedule: {
        id: uuidV7(),
        status: "approved",
        effectiveFrom: current.effectiveFrom,
        effectiveTo: current.effectiveTo,
        approvedAt: input.now,
        completedAt: null,
        completionReason: null,
      },
    };
    input.books[index] = next;
    return next;
  }
  if (
    [
      "add_rate",
      "update_rate",
      "remove_rate",
      "update_discount_matrix",
    ].includes(input.action)
  ) {
    if (current.status !== "draft" || current.activationRequestedBy)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.editLocked",
      );
  }
  if (input.action === "remove_rate") {
    const { id } = z.object({ id: z.uuid() }).strict().parse(input.payload);
    if (!current.rateCards.some((rate) => rate.id === id))
      throw new DemoPriceBookProblem(
        404,
        "NOT_FOUND",
        "adminPricing.command.rateNotFound",
      );
    const rates = current.rateCards.filter((rate) => rate.id !== id);
    const next = {
      ...current,
      rowVersion: current.rowVersion + 1,
      rateCards: rates,
      rateCardCount: rates.length,
      regions: [...new Set(rates.map((rate) => rate.region))].sort(),
    };
    input.books[index] = next;
    return next;
  }
  if (input.action === "update_discount_matrix") {
    const parsedMatrix = discountMatrixSchema.parse(input.payload);
    const matrix = JSON.parse(JSON.stringify(parsedMatrix)) as DiscountMatrix;
    try {
      validatePriceBook({
        ...domainPriceBook(current),
        discountMatrix: matrix,
      });
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.discountInvalid",
        { detail: domainDetail(error) },
      );
    }
    const next = {
      ...current,
      rowVersion: current.rowVersion + 1,
      discountMatrix: matrix,
    };
    input.books[index] = next;
    return next;
  }
  if (input.action === "add_rate" || input.action === "update_rate") {
    if (current.status !== "draft")
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.rateDraftOnly",
      );
    const parsed = rateSchema.parse(input.payload);
    const existing =
      input.action === "update_rate"
        ? current.rateCards.find((rate) => rate.id === parsed.id)
        : undefined;
    if (input.action === "update_rate" && !existing)
      throw new DemoPriceBookProblem(
        404,
        "NOT_FOUND",
        "adminPricing.command.rateNotFound",
      );
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
      rateCards: [
        ...current.rateCards.filter(
          (entry) => !existing || entry.id !== existing.id,
        ),
        rate,
      ],
      rateCardCount: current.rateCardCount + (existing ? 0 : 1),
      regions: [
        ...new Set([
          ...current.rateCards
            .filter((entry) => !existing || entry.id !== existing.id)
            .map((entry) => entry.region),
          rate.region,
        ]),
      ].sort(),
    } satisfies DemoPriceBook;
    try {
      validatePriceBook(domainPriceBook(next));
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.rateInvalid",
        { detail: domainDetail(error) },
      );
    }
    input.books[index] = next;
    return next;
  }

  const { reason } = decisionSchema.parse(input.payload);
  if (input.action === "reject_activation") {
    if (
      current.status !== "draft" ||
      !current.activationRequestedBy ||
      current.activationRequestedBy === input.actorId
    )
      throw new DemoPriceBookProblem(
        422,
        "TWO_AUTHORITY_REQUIRED",
        "adminPricing.command.rejectDistinct",
      );
    const next = {
      ...current,
      rowVersion: current.rowVersion + 1,
      activationRequestedBy: null,
      activationRequestedByEmail: null,
      activationRequestedAt: null,
      lastDecisionAt: input.now,
      lastDecisionReason: reason,
    };
    input.books[index] = next;
    return next;
  }
  if (input.action === "request_activation") {
    if (current.status !== "draft" || current.activationRequestedBy)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.proposeUnproposed",
      );
    try {
      validatePriceBook(domainPriceBook(current));
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.bookInvalid",
        { detail: domainDetail(error) },
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
      input.books.some(
        (book) =>
          book.currency === current.currency &&
          book.activationSchedule?.status === "approved",
      )
    )
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.activateScheduled",
      );
    if (
      current.status !== "draft" ||
      !current.activationRequestedBy ||
      current.activationRequestedBy === input.actorId
    )
      throw new DemoPriceBookProblem(
        422,
        "TWO_AUTHORITY_REQUIRED",
        "adminPricing.command.activateDistinct",
      );
    try {
      validatePriceBook(domainPriceBook(current));
    } catch (error) {
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.bookInvalid",
        { detail: domainDetail(error) },
      );
    }
    const occurredOn = input.now.slice(0, 10);
    if (current.effectiveFrom > occurredOn)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.activateEarly",
      );
    if (current.effectiveTo && current.effectiveTo < occurredOn)
      throw new DemoPriceBookProblem(
        422,
        "INVALID_STATE",
        "adminPricing.command.activateLate",
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
      "adminPricing.command.retireActiveOnly",
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

function problem(requestId: string, error: unknown, t: Translator): Response {
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
      title: "Price-book command refused", // i18n-exempt: RFC 9457 problem title, an API contract field; clients render `detail`
      status,
      detail: known
        ? t(error.detailId, error.values)
        : validation
          ? t("adminPricing.command.validation")
          : t("adminPricing.command.failed"),
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
      session.impersonation ||
      !session.isInternalStaff ||
      !session.roles.some((role) => hasPermission(role, "quote:approve")) ||
      !session.mfaVerified ||
      !session.recentAuthenticationVerified
    )
      throw new DemoPriceBookProblem(
        403,
        "PRICE_BOOK_AUTHORITY_FORBIDDEN",
        "adminPricing.command.forbidden",
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
        "adminPricing.command.idempotencyRequired",
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
            "adminPricing.command.idempotencyConflict",
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
    // i18n-exempt: internal invariant; surfaces as the translated 500 detail, never as this text
    if (!result) throw new Error("Demo price-book command produced no result");
    return Response.json(result, {
      headers: {
        "cache-control": "private, no-store",
        "idempotency-replayed": String(replayed),
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    // The route runs inside the request, so the language is the reader's
    // cookie, the same one the pages read.
    return problem(requestId, error, await getTranslations());
  }
}
