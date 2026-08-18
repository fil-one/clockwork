import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionClaims } from "@clockwork/api";

import {
  demoAccessCookieName,
  issueDemoAccessCookie,
} from "@/src/auth/demo-access";

const sessionMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  resolve: vi.fn<(request: Request) => Promise<SessionClaims | null>>(),
}));
interface QueueRefreshInput {
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
}

interface QueueRefreshResult {
  readonly refreshedAt: string;
  readonly refreshedRecords: number;
  readonly replayed: boolean;
}

const queueMocks = vi.hoisted(() => ({
  refresh: vi.fn<(input: QueueRefreshInput) => Promise<QueueRefreshResult>>(),
}));
const priceBookMocks = vi.hoisted(() => ({ handle: vi.fn() }));
const registrationMocks = vi.hoisted(() => ({ handle: vi.fn() }));
const quoteMocks = vi.hoisted(() => ({ direct: vi.fn(), partner: vi.fn() }));
const partnerControlMocks = vi.hoisted(() => ({
  brand: vi.fn(),
  renewal: vi.fn(),
  renewalTarget: vi.fn(),
}));
const customerControlMocks = vi.hoisted(() => ({ handle: vi.fn() }));
const paymentMocks = vi.hoisted(() => ({ handle: vi.fn() }));

vi.mock("@/src/auth/session", () => ({
  WorkosNextSessionResolver: class {
    public constructor(options: unknown) {
      sessionMocks.construct(options);
    }

    public resolve(request: Request): Promise<SessionClaims | null> {
      return sessionMocks.resolve(request);
    }
  },
}));
vi.mock("@/src/features/experience-server/projection-source", () => ({
  refreshDemoQueueProjections: queueMocks.refresh,
}));
vi.mock(
  "@/src/features/internal-ops/price-books/demo-price-book-command",
  () => ({ handleDemoPriceBookCommand: priceBookMocks.handle }),
);
vi.mock("@/src/features/experience-server/demo-quote-command", () => ({
  handleDemoQuoteCommand: quoteMocks.direct,
}));
vi.mock("@/src/features/customer-partner/partner/demo-partner-quote", () => ({
  handleDemoPartnerQuoteCommand: quoteMocks.partner,
}));
vi.mock("@/src/features/customer-partner/partner/demo-partner-brand", () => ({
  handleDemoPartnerBrand: partnerControlMocks.brand,
}));
vi.mock("@/src/features/customer-partner/partner/demo-partner-renewal", () => ({
  demoPartnerRenewalOrderId: partnerControlMocks.renewalTarget,
  handleDemoPartnerRenewal: partnerControlMocks.renewal,
}));
vi.mock("@/src/features/experience-server/demo-account-controls", () => ({
  handleDemoCustomerAccountControl: customerControlMocks.handle,
}));
vi.mock("@/src/features/experience-server/demo-invoice-payment", () => ({
  handleDemoInvoicePayment: paymentMocks.handle,
}));
vi.mock(
  "@/src/features/customer-partner/partner/demo-deal-registration",
  () => ({ handleDemoDealRegistrationCommand: registrationMocks.handle }),
);

import {
  demoMutationOriginAllowed,
  handle,
  handleDemoQueueProjectionRefresh,
} from "./demo-app";

const csrfToken = "12345678901234567890123456789012";
const orderProofHeaders = {
  origin: "https://demo.clockwork.test",
  cookie: `clockwork-csrf=${csrfToken}`,
  "x-csrf-token": csrfToken,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ORIGIN", "https://demo.clockwork.test");
  sessionMocks.resolve.mockResolvedValue({
    userId: "22222222-2222-4222-8222-222222222222",
    organizationId: "66666666-6666-4666-8666-666666666666",
    accountIds: ["11111111-1111-4111-8111-111111111111"],
    roles: ["owner"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  });
  queueMocks.refresh.mockResolvedValue({
    refreshedAt: "2026-08-18T12:00:00.000Z",
    refreshedRecords: 3,
    replayed: false,
  });
  priceBookMocks.handle.mockResolvedValue(Response.json({ ok: true }));
  registrationMocks.handle.mockResolvedValue(Response.json({ ok: true }));
  quoteMocks.direct.mockResolvedValue(
    Response.json({
      record: {
        resource: "quotes",
        rowVersion: 1,
        data: { route: "direct" },
      },
    }),
  );
  quoteMocks.partner.mockResolvedValue(Response.json({ lane: "partner" }));
  partnerControlMocks.brand.mockResolvedValue(Response.json({ ok: true }));
  partnerControlMocks.renewal.mockResolvedValue(Response.json({ ok: true }));
  partnerControlMocks.renewalTarget.mockImplementation((pathname: string) =>
    pathname.endsWith("/declines")
      ? { orderId: "demo-partner-renewal-ec-0038", action: "decline" }
      : { orderId: "demo-partner-renewal-ec-0038", action: "request" },
  );
  customerControlMocks.handle.mockResolvedValue(Response.json({ ok: true }));
  paymentMocks.handle.mockResolvedValue(
    Response.json({ provider: "demo_sandbox", status: "paid" }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function commandRequest(headers: Record<string, string>): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/quotes",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        id: "88888888-8888-4888-8888-888888888888",
        accountId: "11111111-1111-4111-8111-111111111111",
        action: "create",
        payload: { route: "direct" },
      }),
    },
  );
}

function orderRequest(body: unknown): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/orders",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "demo-order-boundary-0001",
        ...orderProofHeaders,
      },
      body: JSON.stringify(body),
    },
  );
}

function priceBookRequest(): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/price_books",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "demo-price-book-command-0001",
        ...orderProofHeaders,
      },
      body: JSON.stringify({
        id: "66000000-0000-4000-8000-000000000099",
        action: "create",
        payload: {},
      }),
    },
  );
}

function registrationRequest(): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/deal_registrations",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "demo-registration-command-0001",
        ...orderProofHeaders,
      },
      body: JSON.stringify({
        id: "77000000-0000-4000-8000-000000000001",
        accountId: "11000000-0000-4000-8000-000000000003",
        action: "create",
        payload: {},
      }),
    },
  );
}

function quoteRequest(): Request {
  return new Request(
    "https://demo.clockwork.test/api/v1/core/commands/quotes",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "demo-quote-command-0001",
        ...orderProofHeaders,
      },
      body: JSON.stringify({ id: "78000000-0000-4000-8000-000000000001" }),
    },
  );
}

function partnerControlRequest(path: string): Request {
  return new Request(`https://demo.clockwork.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "demo-partner-control-0001",
      ...orderProofHeaders,
    },
    body: JSON.stringify({ accountId: "11000000-0000-4000-8000-000000000006" }),
  });
}

function customerControlRequest(method: string, path: string): Request {
  return new Request(`https://demo.clockwork.test${path}`, {
    method,
    headers: {
      ...(method === "GET"
        ? {}
        : {
            "content-type": "application/json",
            "idempotency-key": "demo-customer-control-0001",
            ...orderProofHeaders,
          }),
    },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
}

function queueRefreshRequest(
  path = "/api/demo/projections/queues/refresh",
  body?: string,
): Request {
  return new Request(`https://demo.clockwork.test${path}`, {
    method: "POST",
    headers: {
      "idempotency-key": "demo-queue-refresh-0001",
      ...orderProofHeaders,
    },
    ...(body === undefined ? {} : { body }),
  });
}

function validPrepareOrderBody(): Readonly<Record<string, unknown>> {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    accountId: "11111111-1111-4111-8111-111111111111",
    action: "prepare_artifact",
    payload: {
      quoteId: "44444444-4444-4444-8444-444444444444",
      signerUserId: "22222222-2222-4222-8222-222222222222",
      authorityTitle: "Operations Director",
      authorityAttested: true,
      serviceStartsOn: "2027-01-01",
      acceptedAt: "2026-08-18T12:00:00.000Z",
      orderLineIds: ["55555555-5555-4555-8555-555555555555"],
    },
  };
}

describe("demo commerce api", () => {
  it("answers a mutation that carries replay and CSRF evidence", async () => {
    const response = await handle(
      commandRequest({
        ...orderProofHeaders,
        "idempotency-key": "demo-quote-command-1",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      record: { resource: "quotes", rowVersion: 1, data: { route: "direct" } },
    });
  });

  it("refuses a mutation with no idempotency key", async () => {
    const response = await handle(commandRequest(orderProofHeaders));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  it("refuses a mutation with no CSRF token", async () => {
    const response = await handle(
      commandRequest({
        origin: orderProofHeaders.origin,
        cookie: orderProofHeaders.cookie,
        "idempotency-key": "demo-quote-command-2",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CSRF_REJECTED",
    });
  });

  it("requires origin validation for non-order demo mutations", async () => {
    const response = await handle(
      commandRequest({
        ...orderProofHeaders,
        origin: "https://attacker.example",
        "idempotency-key": "demo-quote-command-3",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORIGIN_REJECTED",
    });
  });

  it("requires the configured signed grant for every demo API request", async () => {
    const password = "demo-app-boundary-test-password";
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", password);
    const url = "https://demo.clockwork.test/api/v1/system/nothing-here";

    const denied = await handle(new Request(url));
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: "DEMO_ACCESS_REQUIRED",
    });

    const grant = await issueDemoAccessCookie(password);
    const allowed = await handle(
      new Request(url, {
        headers: { cookie: `${demoAccessCookieName}=${grant.value}` },
      }),
    );
    expect(allowed.status).toBe(404);
    await expect(allowed.json()).resolves.toMatchObject({
      code: "DEMO_OPERATION_UNAVAILABLE",
    });
  });

  it("serves the active agreement template the click-through surface verifies", async () => {
    const response = await handle(
      new Request(
        "https://demo.clockwork.test/api/v1/lifecycle/agreement-templates/active?type=csa&jurisdiction=US",
      ),
    );
    const template = (await response.json()) as {
      exactText: string;
      exactTextHash: string;
      executionMode: string;
    };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(template.exactText),
    );

    expect(response.status).toBe(200);
    expect(template.executionMode).toBe("click_through");
    expect(
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(template.exactTextHash);
  });

  it("declines checkout instead of simulating a payment provider", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/payment-sessions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-payment-session-1",
          ...orderProofHeaders,
        },
        body: JSON.stringify({
          accountId: "11111111-1111-4111-8111-111111111111",
          invoiceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_PAYMENT_UNAVAILABLE",
    });
  });

  it("routes exact demo sandbox payment paths after identity and mutation proof", async () => {
    const rawBody =
      '{"accountId":"11111111-1111-4111-8111-111111111111", "invoiceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}';
    const input = new Request(
      "https://demo.clockwork.test/api/demo/payments/sessions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-sandbox-payment-0001",
          ...orderProofHeaders,
        },
        body: rawBody,
      },
    );
    paymentMocks.handle.mockImplementationOnce(async (request: Request) => {
      expect(request).toBe(input);
      expect(request.bodyUsed).toBe(false);
      expect(await request.text()).toBe(rawBody);
      return Response.json({ provider: "demo_sandbox", status: "paid" });
    });
    sessionMocks.resolve.mockImplementationOnce((request: Request) => {
      expect(request).toBe(input);
      expect(request.bodyUsed).toBe(false);
      return Promise.resolve({
        userId: "22222222-2222-4222-8222-222222222222",
        organizationId: "66666666-6666-4666-8666-666666666666",
        accountIds: ["11111111-1111-4111-8111-111111111111"],
        roles: ["owner"],
        isInternalStaff: false,
        mfaVerified: true,
        recentAuthenticationVerified: true,
      });
    });

    const response = await handle(input);

    expect(response.status).toBe(200);
    expect(paymentMocks.handle).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        userId: "22222222-2222-4222-8222-222222222222",
      }),
    );
    expect(input.bodyUsed).toBe(true);
  });

  it("refuses cross-origin sandbox completion and does not match lookalikes", async () => {
    const sessionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const refused = await handle(
      new Request(
        `https://demo.clockwork.test/api/demo/payments/sessions/${sessionId}/complete`,
        {
          method: "POST",
          headers: {
            ...orderProofHeaders,
            origin: "https://attacker.example",
            "idempotency-key": "demo-sandbox-payment-0002",
          },
        },
      ),
    );
    expect(refused.status).toBe(403);
    await expect(refused.json()).resolves.toMatchObject({
      code: "ORIGIN_REJECTED",
    });
    expect(paymentMocks.handle).not.toHaveBeenCalled();

    const lookalike = await handle(
      new Request("https://demo.clockwork.test/api/demo/payments/sessions-x", {
        method: "POST",
        headers: {
          ...orderProofHeaders,
          "idempotency-key": "demo-sandbox-payment-0003",
        },
      }),
    );
    expect(lookalike.status).toBe(404);
    expect(paymentMocks.handle).not.toHaveBeenCalled();
  });

  /**
   * The order lane is run, not simulated, so it is the one command the echo
   * handler must not answer. Reaching an authentication failure rather than a
   * `{record: {data: <the payload>}}` echo is the evidence that the request was
   * routed to the lane -- the lane reads a session, and this request carries
   * none.
   */
  it("routes an order command to the lane rather than echoing it", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-1",
          ...orderProofHeaders,
        },
        body: JSON.stringify({
          id: "88888888-8888-4888-8888-888888888888",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "accept",
          payload: {},
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
    });
  });

  it("resolves the exact request before the order lane consumes its body", async () => {
    const input = orderRequest(validPrepareOrderBody());
    const bodyRead = vi.spyOn(input, "arrayBuffer");
    sessionMocks.resolve.mockImplementationOnce((request: Request) => {
      expect(request).toBe(input);
      expect(request.bodyUsed).toBe(false);
      expect(bodyRead).not.toHaveBeenCalled();
      return Promise.resolve({
        userId: "22222222-2222-4222-8222-222222222222",
        organizationId: "66666666-6666-4666-8666-666666666666",
        accountIds: ["11111111-1111-4111-8111-111111111111"],
        roles: ["member"],
        isInternalStaff: false,
        mfaVerified: true,
        recentAuthenticationVerified: true,
      });
    });

    const response = await handle(input);

    expect(sessionMocks.construct).toHaveBeenCalledWith({
      requireBoundSession: true,
    });
    expect(sessionMocks.resolve).toHaveBeenCalledWith(input);
    expect(bodyRead).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORDER_AUTHORITY_FORBIDDEN",
    });
  });

  it("fails closed before reading an order when identity is absent", async () => {
    sessionMocks.resolve.mockResolvedValueOnce(null);
    const input = orderRequest(validPrepareOrderBody());
    const bodyRead = vi.spyOn(input, "arrayBuffer");

    const response = await handle(input);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_IDENTITY_REQUIRED",
      retryable: false,
    });
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("bounds identity resolution errors before reading the order", async () => {
    sessionMocks.resolve.mockRejectedValueOnce(new Error("identity backend"));
    const input = orderRequest(validPrepareOrderBody());
    const bodyRead = vi.spyOn(input, "arrayBuffer");

    const response = await handle(input);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_IDENTITY_UNAVAILABLE",
      retryable: true,
    });
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it("refuses an order command with no replay evidence", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
  });

  it("requires the order command origin to match the configured app", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-2",
          ...orderProofHeaders,
          origin: "https://attacker.example",
        },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ORIGIN_REJECTED",
    });
  });

  it("accepts the actual same-origin host for local and deploy-preview requests", async () => {
    const response = await handle(
      new Request("http://127.0.0.1:3317/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-local-1",
          ...orderProofHeaders,
          host: "127.0.0.1:3317",
          origin: "http://127.0.0.1:3317",
        },
        body: JSON.stringify({
          id: "88888888-8888-4888-8888-888888888888",
          accountId: "11111111-1111-4111-8111-111111111111",
          action: "accept",
          payload: {},
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACTION_NOT_ALLOWED",
    });
  });

  it("requires the order command CSRF header to match its cookie", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "demo-order-command-3",
          ...orderProofHeaders,
          "x-csrf-token": "abcdefabcdefabcdefabcdefabcdefab",
        },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "CSRF_REJECTED",
    });
  });

  it("validates order idempotency evidence before entering the lane", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/core/commands/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...orderProofHeaders,
        },
        body: JSON.stringify({ id: "x", action: "create", payload: {} }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  it("routes price-book commands with the exact verified finance session", async () => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000008",
      accountIds: [],
      roles: ["finance_approver"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const input = priceBookRequest();
    const response = await handle(input);
    expect(response.status).toBe(200);
    expect(priceBookMocks.handle).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        userId: "21000000-0000-4000-8000-000000000008",
        roles: ["finance_approver"],
      }),
    );
  });

  it("routes deal registrations with the exact verified partner session", async () => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000003",
      accountIds: ["11000000-0000-4000-8000-000000000003"],
      roles: ["partner_admin"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const input = registrationRequest();
    const response = await handle(input);
    expect(response.status).toBe(200);
    expect(registrationMocks.handle).toHaveBeenCalledWith(
      input,
      expect.objectContaining({
        userId: "21000000-0000-4000-8000-000000000003",
        roles: ["partner_admin"],
      }),
    );
  });

  it("routes partner and customer quotes by exact session authority", async () => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000003",
      accountIds: ["11000000-0000-4000-8000-000000000003"],
      roles: ["partner_admin"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const partnerInput = quoteRequest();
    expect((await handle(partnerInput)).status).toBe(200);
    expect(quoteMocks.partner).toHaveBeenCalledWith(
      partnerInput,
      expect.objectContaining({ roles: ["partner_admin"] }),
    );
    expect(quoteMocks.direct).not.toHaveBeenCalled();

    vi.clearAllMocks();
    quoteMocks.direct.mockResolvedValue(Response.json({ lane: "direct" }));
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000001",
      accountIds: ["11000000-0000-4000-8000-000000000001"],
      roles: ["owner"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const customerInput = quoteRequest();
    expect((await handle(customerInput)).status).toBe(200);
    expect(quoteMocks.direct).toHaveBeenCalledWith(
      customerInput,
      expect.objectContaining({ roles: ["owner"] }),
    );
    expect(quoteMocks.partner).not.toHaveBeenCalled();
  });

  it("refuses mixed partner authority before either quote handler reads the body", async () => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000003",
      accountIds: ["11000000-0000-4000-8000-000000000003"],
      roles: ["partner_admin", "owner"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const input = quoteRequest();
    const bodyRead = vi.spyOn(input, "arrayBuffer");
    const response = await handle(input);
    expect(response.status).toBe(403);
    expect(bodyRead).not.toHaveBeenCalled();
    expect(quoteMocks.direct).not.toHaveBeenCalled();
    expect(quoteMocks.partner).not.toHaveBeenCalled();
  });

  it("routes exact partner brand and renewal destinations through the verified session", async () => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000003",
      accountIds: ["11000000-0000-4000-8000-000000000003"],
      roles: ["partner_admin"],
      isInternalStaff: false,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const brand = partnerControlRequest(
      "/api/v1/lifecycle/partners/11000000-0000-4000-8000-000000000003/domains",
    );
    expect((await handle(brand)).status).toBe(200);
    expect(partnerControlMocks.brand).toHaveBeenCalledWith(
      brand,
      expect.objectContaining({ roles: ["partner_admin"] }),
      "11000000-0000-4000-8000-000000000003",
    );

    const renewal = partnerControlRequest(
      "/api/v1/lifecycle/renewals/demo-partner-renewal-ec-0038/requests",
    );
    expect((await handle(renewal)).status).toBe(200);
    expect(partnerControlMocks.renewal).toHaveBeenCalledWith(
      renewal,
      expect.objectContaining({ roles: ["partner_admin"] }),
      { orderId: "demo-partner-renewal-ec-0038", action: "request" },
    );
  });

  it.each([
    [
      "GET",
      "/api/v1/core/records/accounts?accountId=11000000-0000-4000-8000-000000000001",
    ],
    ["POST", "/api/v1/core/commands/accounts"],
    ["PUT", "/api/v1/notifications/preferences"],
    [
      "POST",
      "/api/v1/lifecycle/organizations/31000000-0000-4000-8000-000000000001/invites",
    ],
    [
      "PUT",
      "/api/v1/lifecycle/accounts/11000000-0000-4000-8000-000000000001/procurement-profile",
    ],
  ])(
    "routes the exact %s %s customer account control",
    async (method, path) => {
      const input = customerControlRequest(method, path);
      const response = await handle(input);
      expect(response.status).toBe(200);
      expect(customerControlMocks.handle).toHaveBeenCalledWith(
        input,
        expect.objectContaining({ roles: ["owner"] }),
      );
    },
  );

  it.each([
    ["GET", "/api/v1/core/records/accounts-extra"],
    ["POST", "/api/v1/core/commands/accounts/extra"],
    ["PUT", "/api/v1/notifications/preferences-extra"],
    ["POST", "/api/v1/lifecycle/organizations/not-a-uuid/invites"],
    [
      "PUT",
      "/api/v1/lifecycle/accounts/11000000-0000-4000-8000-000000000001/procurement-profile/extra",
    ],
  ])(
    "does not grant the lookalike %s %s account route",
    async (method, path) => {
      await handle(customerControlRequest(method, path));
      expect(customerControlMocks.handle).not.toHaveBeenCalled();
    },
  );

  it("reports an operation the demo does not simulate as problem details", async () => {
    const response = await handle(
      new Request("https://demo.clockwork.test/api/v1/system/nothing-here"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_OPERATION_UNAVAILABLE",
      retryable: false,
    });
  });

  it("fails demo webhooks closed without buffering unsigned provider bytes", async () => {
    const request = new Request(
      "https://demo.clockwork.test/api/v1/webhooks/stripe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "provider-event" }),
      },
    );
    const bodyRead = vi.spyOn(request, "arrayBuffer");

    const response = await handle(request);

    expect(response.status).toBe(503);
    expect(bodyRead).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "DEMO_WEBHOOK_UNAVAILABLE",
      retryable: false,
    });
  });
});

describe("demo queue refresh destination security", () => {
  beforeEach(() => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000009",
      accountIds: [],
      roles: ["internal_operator"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
  });

  it("authorizes the exact bodyless request and reports durable replay", async () => {
    const response = await handleDemoQueueProjectionRefresh(
      queueRefreshRequest(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("idempotency-replayed")).toBe("false");
    expect(queueMocks.refresh).toHaveBeenCalledTimes(1);
    const refreshInput = queueMocks.refresh.mock.calls[0]?.[0];
    expect(refreshInput?.actorId).toBe("21000000-0000-4000-8000-000000000009");
    expect(refreshInput?.idempotencyKey).toBe("demo-queue-refresh-0001");
    expect(refreshInput?.requestDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("accepts Next's non-null empty stream when the encoded length is exactly zero", async () => {
    const input = queueRefreshRequest();
    Object.defineProperty(input, "body", {
      configurable: true,
      value: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });
    input.headers.set("content-length", "0");
    const bodyRead = vi.spyOn(input, "arrayBuffer");

    const response = await handleDemoQueueProjectionRefresh(input);

    expect(input.body).not.toBeNull();
    expect(response.status).toBe(200);
    expect(bodyRead).not.toHaveBeenCalled();
    expect(queueMocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("rejects any request body without buffering or resolving identity", async () => {
    const input = queueRefreshRequest(
      "/api/demo/projections/queues/refresh",
      "{}",
    );
    const bodyRead = vi.spyOn(input, "arrayBuffer");
    const response = await handleDemoQueueProjectionRefresh(input);
    expect(response.status).toBe(422);
    expect(bodyRead).not.toHaveBeenCalled();
    expect(sessionMocks.resolve).not.toHaveBeenCalled();
    expect(queueMocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    ["nonzero content length", { "content-length": "1" }],
    ["invalid content length", { "content-length": "not-a-length" }],
    ["transfer encoding", { "transfer-encoding": "chunked" }],
    [
      "transfer encoding even with zero length",
      { "content-length": "0", "transfer-encoding": "chunked" },
    ],
  ])("rejects %s without buffering", async (_name, encodedHeaders) => {
    const input = queueRefreshRequest();
    for (const [name, value] of Object.entries(encodedHeaders))
      input.headers.set(name, value);
    const bodyRead = vi.spyOn(input, "arrayBuffer");

    const response = await handleDemoQueueProjectionRefresh(input);

    expect(response.status).toBe(422);
    expect(bodyRead).not.toHaveBeenCalled();
    expect(sessionMocks.resolve).not.toHaveBeenCalled();
    expect(queueMocks.refresh).not.toHaveBeenCalled();
  });

  it("refuses a different path before granting queue authority", async () => {
    const response = await handleDemoQueueProjectionRefresh(
      queueRefreshRequest("/api/demo/projections/queues/not-refresh"),
    );
    expect(response.status).toBe(404);
    expect(sessionMocks.resolve).not.toHaveBeenCalled();
    expect(queueMocks.refresh).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a cross-origin request",
      mutate: (headers: Headers) =>
        headers.set("origin", "https://attacker.example"),
      status: 403,
    },
    {
      name: "a missing CSRF cookie",
      mutate: (headers: Headers) => headers.delete("cookie"),
      status: 403,
    },
    {
      name: "a mismatched CSRF header",
      mutate: (headers: Headers) =>
        headers.set("x-csrf-token", "99999999999999999999999999999999"),
      status: 403,
    },
    {
      name: "a missing idempotency key",
      mutate: (headers: Headers) => headers.delete("idempotency-key"),
      status: 422,
    },
    {
      name: "a short idempotency key",
      mutate: (headers: Headers) => headers.set("idempotency-key", "too-short"),
      status: 422,
    },
  ])("refuses $name before resolving identity", async ({ mutate, status }) => {
    const input = queueRefreshRequest();
    mutate(input.headers);
    const response = await handleDemoQueueProjectionRefresh(input);
    expect(response.status).toBe(status);
    expect(sessionMocks.resolve).not.toHaveBeenCalled();
    expect(queueMocks.refresh).not.toHaveBeenCalled();
  });

  it("requires an internal role holding system operation authority", async () => {
    sessionMocks.resolve.mockResolvedValue({
      userId: "21000000-0000-4000-8000-000000000008",
      accountIds: [],
      roles: ["finance_approver"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    });
    const response = await handleDemoQueueProjectionRefresh(
      queueRefreshRequest(),
    );
    expect(response.status).toBe(403);
    expect(queueMocks.refresh).not.toHaveBeenCalled();
  });
});

describe("demo order mutation origin resolution", () => {
  const base = {
    configuredOrigin: "https://clockwork.example",
    host: "internal-next:3000",
    forwardedHost: null,
    forwardedProtocol: null,
    requestProtocol: "http",
  } as const;

  it("allows the configured canonical origin", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://clockwork.example",
      }),
    ).toBe(true);
  });

  it("uses the served Host when Next rewrites the internal request URL", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "http://127.0.0.1:3317",
        host: "127.0.0.1:3317",
      }),
    ).toBe(true);
  });

  it("uses a strict forwarded host and protocol for deploy previews", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://deploy-preview-42--clockwork.netlify.app",
        forwardedHost: "deploy-preview-42--clockwork.netlify.app",
        forwardedProtocol: "https",
      }),
    ).toBe(true);
  });

  it("rejects malformed forwarded hosts and attacker origins", () => {
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://deploy-preview-42--clockwork.netlify.app",
        forwardedHost:
          "deploy-preview-42--clockwork.netlify.app, attacker.example",
        forwardedProtocol: "https",
      }),
    ).toBe(false);
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://clockwork.example",
        forwardedHost: "clockwork.example/attacker",
        forwardedProtocol: "https",
      }),
    ).toBe(false);
    expect(
      demoMutationOriginAllowed({
        ...base,
        origin: "https://attacker.example",
        forwardedHost: "deploy-preview-42--clockwork.netlify.app",
        forwardedProtocol: "https",
      }),
    ).toBe(false);
  });
});
