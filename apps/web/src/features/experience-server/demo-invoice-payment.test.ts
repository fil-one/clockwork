import { describe, expect, it } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import {
  createMemoryDemoStore,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import { demoAccountIds } from "@clockwork/testing/personas";

import {
  demoInvoicePayments,
  handleDemoInvoicePayment,
} from "./demo-invoice-payment";
import { demoAdditionalRecords } from "./demo-portal-records";

const invoice = demoAdditionalRecords.find(
  (record) => record.key === "invoice-meridian-overdue",
);
if (!invoice?.aggregateId)
  throw new Error("The payable demo invoice is missing");

const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000001",
  organizationId: "31000000-0000-4000-8000-000000000001",
  accountIds: [demoAccountIds.direct],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function request(path: string, key: string, body?: unknown) {
  return new Request(`https://demo.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const createBody = {
  accountId: demoAccountIds.direct,
  invoiceId: invoice.aggregateId,
};

describe("demo invoice payment sandbox", () => {
  it("durably creates and completes one sandbox attempt without provider claims", async () => {
    const store = createMemoryDemoStore();
    const prepared = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-prepare-key-0001",
        createBody,
      ),
      session,
      store,
    );
    expect(prepared.status).toBe(200);
    const preparedBody = (await prepared.json()) as {
      sessionId: string;
      paymentAttemptId: string;
    };
    expect(preparedBody).toMatchObject({
      provider: "demo_sandbox",
      invoiceId: invoice.aggregateId,
      status: "requires_customer_action",
      receiptId: null,
    });

    const completed = await handleDemoInvoicePayment(
      request(
        `/api/demo/payments/sessions/${preparedBody.sessionId}/complete`,
        "payment-complete-key-0001",
      ),
      session,
      store,
    );
    expect(completed.status).toBe(200);
    const completedBody = (await completed.json()) as {
      receiptId: string | null;
    };
    expect(completedBody).toMatchObject({
      provider: "demo_sandbox",
      invoiceId: invoice.aggregateId,
      sessionId: preparedBody.sessionId,
      paymentAttemptId: preparedBody.paymentAttemptId,
      status: "paid",
    });
    expect(completedBody.receiptId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(demoInvoicePayments(await store.read())).toEqual([
      expect.objectContaining({
        sessionId: preparedBody.sessionId,
        status: "paid",
      }),
    ]);
    await resetDemoExperience(store, {
      target: "demo",
      environment: { NODE_ENV: "test" },
    });
    expect(demoInvoicePayments(await store.read())).toEqual([]);
  });

  it("replays exact requests and conflicts when a key is reused", async () => {
    const store = createMemoryDemoStore();
    const first = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-prepare-key-0002",
        createBody,
      ),
      session,
      store,
    );
    const firstBody = (await first.json()) as { sessionId: string };
    const replay = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-prepare-key-0002",
        createBody,
      ),
      session,
      store,
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(await replay.json()).toEqual(firstBody);

    const conflict = await handleDemoInvoicePayment(
      request(
        `/api/demo/payments/sessions/${firstBody.sessionId}/complete`,
        "payment-prepare-key-0002",
      ),
      session,
      store,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
    expect(demoInvoicePayments(await store.read())).toHaveLength(1);
  });

  it("deduplicates multiple prepares and never pays an invoice twice", async () => {
    const store = createMemoryDemoStore();
    const first = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-prepare-key-0003",
        createBody,
      ),
      session,
      store,
    );
    const firstBody = (await first.json()) as { sessionId: string };
    const second = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-prepare-key-0004",
        createBody,
      ),
      session,
      store,
    );
    expect(await second.json()).toMatchObject({
      sessionId: firstBody.sessionId,
    });

    await handleDemoInvoicePayment(
      request(
        `/api/demo/payments/sessions/${firstBody.sessionId}/complete`,
        "payment-complete-key-0002",
      ),
      session,
      store,
    );
    const duplicate = await handleDemoInvoicePayment(
      request(
        `/api/demo/payments/sessions/${firstBody.sessionId}/complete`,
        "payment-complete-key-0003",
      ),
      session,
      store,
    );
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      code: "INVOICE_ALREADY_PAID",
    });
    expect(demoInvoicePayments(await store.read())).toHaveLength(1);
  });

  it("fails closed for missing billing authority, account scope, and completion bodies", async () => {
    const store = createMemoryDemoStore();
    const denied = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-authority-key-0001",
        createBody,
      ),
      { ...session, roles: ["member"] },
      store,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: "PAYMENT_AUTHORITY_FORBIDDEN",
    });

    const wrongAccount = await handleDemoInvoicePayment(
      request("/api/demo/payments/sessions", "payment-scope-key-0001", {
        ...createBody,
        accountId: crypto.randomUUID(),
      }),
      session,
      store,
    );
    expect(wrongAccount.status).toBe(403);

    const prepared = await handleDemoInvoicePayment(
      request(
        "/api/demo/payments/sessions",
        "payment-prepare-key-0005",
        createBody,
      ),
      session,
      store,
    );
    const preparedBody = (await prepared.json()) as { sessionId: string };
    const bodyRejected = await handleDemoInvoicePayment(
      request(
        `/api/demo/payments/sessions/${preparedBody.sessionId}/complete`,
        "payment-complete-key-0004",
        {},
      ),
      session,
      store,
    );
    expect(bodyRejected.status).toBe(422);
    expect(demoInvoicePayments(await store.read())).toEqual([
      expect.objectContaining({ status: "requires_customer_action" }),
    ]);
  });
});
