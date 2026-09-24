import "server-only";
// i18n-exempt-file: demo mirror of the payment API: problem+json titles are the API contract; the interface maps `code`.

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, uuidV7 } from "@clockwork/contracts";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import { idempotencyKey } from "./authorization";
import { demoAdditionalRecords } from "./demo-portal-records";
import { configuredDemoStateStore } from "./demo-state-store";
import { ExperienceProblem } from "./model";

const prefix = "demo-invoice-payment:";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface DemoInvoicePayment {
  readonly kind: "demo_invoice_payment";
  readonly sessionId: string;
  readonly invoiceId: string;
  readonly recordKey: string;
  readonly accountId: string;
  readonly actorId: string;
  readonly status: "requires_customer_action" | "paid";
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly paymentAttemptId: string;
  readonly receiptId: string | null;
}

interface DemoPaymentReceipt {
  readonly kind: "demo_invoice_payment_receipt";
  readonly actorId: string;
  readonly requestHash: string;
  readonly status: number;
  readonly response: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

function isPayment(value: unknown): value is DemoInvoicePayment {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "demo_invoice_payment"
  );
}

function isReceipt(value: unknown): value is DemoPaymentReceipt {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "demo_invoice_payment_receipt"
  );
}

function data(
  state: DemoAdapterState,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  return state.projectionOverrides[`${prefix}${key}`]?.data;
}

function write(
  state: DemoAdapterState,
  key: string,
  value: Readonly<Record<string, unknown>>,
  updatedAt: string,
): DemoAdapterState {
  return {
    ...state,
    projectionOverrides: {
      ...state.projectionOverrides,
      [`${prefix}${key}`]: { version: 1, updatedAt, data: value },
    },
  };
}

function accountScope(session: SessionClaims, accountId: string): void {
  if (
    !session.accountIds.includes(accountId) &&
    session.impersonation?.accountId !== accountId
  )
    throw new ExperienceProblem(
      403,
      "ACCOUNT_SCOPE_FORBIDDEN",
      "The invoice account is outside the authorized scope",
    );
}

function requireBillingAuthority(session: SessionClaims): void {
  if (!session.roles.some((role) => hasPermission(role, "billing:write")))
    throw new ExperienceProblem(
      403,
      "PAYMENT_AUTHORITY_FORBIDDEN",
      "Billing write authority is required",
    );
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(422, "INVALID_BODY", "Body must be an object");
  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !uuidPattern.test(candidate))
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} must be a UUID`);
  return candidate;
}

function receiptKey(actorId: string, key: string): string {
  return createHash("sha256")
    .update(actorId)
    .update("\0")
    .update(key)
    .digest("hex");
}

function requestHash(request: Request, bytes: Uint8Array): string {
  const url = new URL(request.url);
  return createHash("sha256")
    .update(request.method)
    .update("\0")
    .update(url.pathname)
    .update("\0")
    .update(bytes)
    .digest("hex");
}

function paymentResponse(payment: DemoInvoicePayment) {
  return {
    provider: "demo_sandbox",
    sessionId: payment.sessionId,
    invoiceId: payment.invoiceId,
    status: payment.status,
    paymentAttemptId: payment.paymentAttemptId,
    receiptId: payment.receiptId,
    completedAt: payment.completedAt,
  } as const;
}

function responseFromReceipt(
  receipt: DemoPaymentReceipt,
  replayed: boolean,
): Response {
  return Response.json(receipt.response, {
    status: receipt.status,
    headers: {
      "cache-control": "private, no-store",
      "idempotency-replayed": String(replayed),
    },
  });
}

function problem(error: ExperienceProblem, requestId: string): Response {
  return Response.json(
    {
      type: `https://clockwork.test/problems/${error.code.toLowerCase().replaceAll("_", "-")}`,
      title: "Demo sandbox payment refused",
      status: error.status,
      detail: error.message,
      code: error.code,
      requestId,
      retryable: error.status >= 500,
    },
    {
      status: error.status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
      },
    },
  );
}

function seededInvoice(invoiceId: string, accountId: string) {
  return demoAdditionalRecords.find(
    (record) =>
      record.audience === "customer" &&
      record.channel === "billing" &&
      record.aggregateType === "invoice" &&
      record.aggregateId === invoiceId &&
      record.accountId === accountId &&
      record.data.status === "open",
  );
}

export function demoInvoicePayments(
  state: DemoAdapterState,
): readonly DemoInvoicePayment[] {
  const payments: DemoInvoicePayment[] = [];
  for (const [key, override] of Object.entries(state.projectionOverrides)) {
    if (!key.startsWith(`${prefix}session:`)) continue;
    const candidate: unknown = override.data;
    if (isPayment(candidate)) payments.push(structuredClone(candidate));
  }
  return payments;
}

async function execute(input: {
  readonly request: Request;
  readonly session: SessionClaims;
  readonly bytes: Uint8Array;
  readonly store: DemoAdapterStateStore;
  readonly mutate: (
    state: DemoAdapterState,
    now: string,
  ) => {
    readonly state: DemoAdapterState;
    readonly payment: DemoInvoicePayment;
  };
}): Promise<Response> {
  const key = idempotencyKey(input.request);
  const hash = requestHash(input.request, input.bytes);
  const receiptId = receiptKey(input.session.userId, key);
  let replayed = false;
  const committed = await input.store.update((state) => {
    const previous = data(state, `receipt:${receiptId}`);
    if (isReceipt(previous)) {
      if (
        previous.actorId !== input.session.userId ||
        previous.requestHash !== hash
      )
        throw new ExperienceProblem(
          409,
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key was already used for a different request",
        );
      replayed = true;
      return state;
    }
    const now = new Date().toISOString();
    const changed = input.mutate(state, now);
    const receipt: DemoPaymentReceipt = {
      kind: "demo_invoice_payment_receipt",
      actorId: input.session.userId,
      requestHash: hash,
      status: 200,
      response: paymentResponse(changed.payment),
      createdAt: now,
    };
    return {
      ...write(
        changed.state,
        `receipt:${receiptId}`,
        receipt as unknown as Readonly<Record<string, unknown>>,
        now,
      ),
      revision: state.revision + 1,
    };
  });
  const receipt = data(committed, `receipt:${receiptId}`);
  if (!isReceipt(receipt)) throw new Error("DEMO_PAYMENT_RECEIPT_MISSING");
  return responseFromReceipt(receipt, replayed);
}

export async function handleDemoInvoicePayment(
  request: Request,
  session: SessionClaims,
  store: DemoAdapterStateStore = configuredDemoStateStore(),
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    requireBillingAuthority(session);
    const url = new URL(request.url);
    const create =
      request.method === "POST" &&
      url.pathname === "/api/demo/payments/sessions";
    const complete =
      request.method === "POST"
        ? /^\/api\/demo\/payments\/sessions\/([0-9a-f-]{36})\/complete$/iu.exec(
            url.pathname,
          )
        : null;
    if (!create && !complete)
      throw new ExperienceProblem(
        404,
        "DEMO_PAYMENT_NOT_FOUND",
        "This demo payment operation does not exist",
      );

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (create) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new ExperienceProblem(
            422,
            "INVALID_BODY",
            "The request body is not JSON",
          );
        throw error;
      }
      const body = object(parsed);
      if (
        Object.keys(body).some(
          (key) => key !== "accountId" && key !== "invoiceId",
        )
      )
        throw new ExperienceProblem(
          422,
          "INVALID_BODY",
          "Only accountId and invoiceId are accepted",
        );
      const accountId = uuid(body, "accountId");
      const invoiceId = uuid(body, "invoiceId");
      accountScope(session, accountId);
      const invoice = seededInvoice(invoiceId, accountId);
      if (!invoice)
        throw new ExperienceProblem(
          409,
          "INVOICE_NOT_PAYABLE",
          "The invoice is not an open payable demo invoice",
        );
      return await execute({
        request,
        session,
        bytes,
        store,
        mutate: (state, now) => {
          const existing = data(state, `invoice:${invoiceId}`);
          if (isPayment(existing)) {
            if (existing.status === "paid")
              throw new ExperienceProblem(
                409,
                "INVOICE_ALREADY_PAID",
                "The demo invoice has already been paid",
              );
            return { state, payment: existing };
          }
          const payment: DemoInvoicePayment = {
            kind: "demo_invoice_payment",
            sessionId: uuidV7(),
            invoiceId,
            recordKey: invoice.key,
            accountId,
            actorId: session.userId,
            status: "requires_customer_action",
            createdAt: now,
            completedAt: null,
            paymentAttemptId: uuidV7(),
            receiptId: null,
          };
          const stored = write(
            write(
              state,
              `session:${payment.sessionId}`,
              payment as unknown as Readonly<Record<string, unknown>>,
              now,
            ),
            `invoice:${invoiceId}`,
            payment as unknown as Readonly<Record<string, unknown>>,
            now,
          );
          return { state: stored, payment };
        },
      });
    }

    if (bytes.byteLength !== 0)
      throw new ExperienceProblem(
        422,
        "INVALID_BODY",
        "Demo payment completion does not accept a request body",
      );
    const sessionId = complete?.[1] ?? "";
    if (!uuidPattern.test(sessionId))
      throw new ExperienceProblem(
        404,
        "DEMO_PAYMENT_NOT_FOUND",
        "This demo payment session does not exist",
      );
    return await execute({
      request,
      session,
      bytes,
      store,
      mutate: (state, now) => {
        const current = data(state, `session:${sessionId}`);
        if (!isPayment(current))
          throw new ExperienceProblem(
            404,
            "DEMO_PAYMENT_NOT_FOUND",
            "This demo payment session does not exist",
          );
        accountScope(session, current.accountId);
        if (current.status === "paid")
          throw new ExperienceProblem(
            409,
            "INVOICE_ALREADY_PAID",
            "The demo invoice has already been paid",
          );
        const payment: DemoInvoicePayment = {
          ...current,
          status: "paid",
          completedAt: now,
          receiptId: uuidV7(),
        };
        const stored = write(
          write(
            state,
            `session:${sessionId}`,
            payment as unknown as Readonly<Record<string, unknown>>,
            now,
          ),
          `invoice:${payment.invoiceId}`,
          payment as unknown as Readonly<Record<string, unknown>>,
          now,
        );
        return { state: stored, payment };
      },
    });
  } catch (error) {
    return error instanceof ExperienceProblem
      ? problem(error, requestId)
      : problem(
          new ExperienceProblem(
            503,
            "DEMO_PAYMENT_FAILED",
            "The demo sandbox payment could not be recorded",
          ),
          requestId,
        );
  }
}
