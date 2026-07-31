import { ProblemError } from "@clockwork/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import { sessionMiddleware } from "../../auth/session";
import type { ApiVariables } from "../../context";
import { requestContextMiddleware } from "../../middleware/request-context";
import { registerLifecycleRoutes, TransactionalLifecycleService } from ".";
import type {
  LifecycleCommandRepository,
  LifecycleRouteDependencies,
  LifecycleRouteService,
} from ".";

const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000002";
const organizationId = "30000000-0000-4000-8000-000000000001";
const templateId = "40000000-0000-4000-8000-000000000001";

function service(
  overrides: Partial<LifecycleRouteService> = {},
): LifecycleRouteService {
  const result = (name: string) =>
    vi.fn().mockResolvedValue({ id: `${name}-1`, status: "accepted" });
  return {
    register: result("registration"),
    inviteMember: result("invite"),
    switchAccount: result("account-selection"),
    verifyPartnerDomain: result("partner-domain"),
    updateProcurement: result("procurement"),
    publishAgreementTemplate: result("agreement-template"),
    uploadCustomerPaper: result("customer-paper"),
    executeClickThrough: result("agreement"),
    createSignatureEnvelope: result("envelope"),
    ingestSignatureEvent: result("webhook"),
    ingestProvisioningEvent: result("provisioning-webhook"),
    ingestMarketplaceEvent: result("marketplace-webhook"),
    createPoc: result("poc-create"),
    decidePoc: result("poc-decision"),
    convertPoc: result("poc"),
    recoverProvisioning: result("provisioning"),
    acceptPassThroughTerms: result("pass-through"),
    recordInboundNotice: result("notice"),
    renewalCommandCenter: result("renewals"),
    requestRenewal: result("renewal-request"),
    declineRenewal: result("renewal-decline"),
    requestTermination: result("termination"),
    decideTermination: result("termination-approval"),
    createNovation: result("novation"),
    openException: result("exception-open"),
    decideException: result("exception"),
    listSupportSignals: result("support-signals"),
    startMigration: result("migration"),
    decideMigrationMatch: result("migration-match"),
    ...overrides,
  };
}

function app(input: {
  service: LifecycleRouteService;
  accountIds?: readonly string[];
  role?: "owner" | "member" | "internal_operator";
  webhook?: LifecycleRouteDependencies["esignWebhook"];
  registrationBootstrap?: LifecycleRouteDependencies["registrationBootstrap"];
}) {
  const app = new OpenAPIHono<{ Variables: ApiVariables }>();
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(error.problem, error.problem.status as 403 | 503);
    return context.json({ title: error.message, status: 500 }, 500);
  });
  app.use("*", requestContextMiddleware);
  app.use(
    "*",
    sessionMiddleware({
      resolve: () =>
        Promise.resolve({
          userId,
          organizationId,
          accountIds: input.accountIds ?? [accountId],
          roles: [input.role ?? "owner"],
          isInternalStaff: input.role === "internal_operator",
          mfaVerified: true,
          recentAuthenticationVerified: true,
        }),
    }),
  );
  registerLifecycleRoutes(app, {
    service: input.service,
    ...(input.webhook ? { esignWebhook: input.webhook } : {}),
    ...(input.registrationBootstrap
      ? { registrationBootstrap: input.registrationBootstrap }
      : {}),
  });
  return app;
}

const mutationHeaders = {
  "content-type": "application/json",
  "idempotency-key": "lifecycle-route-test-0001",
  "x-forwarded-for": "192.0.2.10",
  "user-agent": "Clockwork integration test",
};

describe("lifecycle API authorization and evidence", () => {
  it("bootstraps the first account from a trusted identity/domain proof without an existing membership", async () => {
    const register = vi
      .fn()
      .mockResolvedValue({ id: accountId, status: "screening_pending" });
    const verifyRegistration = vi.fn().mockResolvedValue({
      actor: { kind: "user" as const, id: "workos:user-1" },
      workosUserId: "workos-user-1",
      domainVerifiedAt: "2026-07-31T16:00:00.000Z",
    });
    const registrationBootstrap = {
      verify: verifyRegistration,
    };
    const response = await app({
      service: service({ register }),
      role: "member",
      accountIds: [],
      registrationBootstrap,
    }).request("/v1/lifecycle/registrations", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        legalName: "Northstar Archive Ltd",
        country: "GB",
        registeredAddress: {
          line1: "1 Archive Way",
          city: "London",
          postalCode: "EC1A 1AA",
          country: "GB",
        },
        relationshipRoles: ["direct_client"],
        businessDomain: "northstar.test",
        registrantEmail: "owner@northstar.test",
        registrationToken: "registration-token-that-is-long-enough",
        taxIds: [{ jurisdiction: "GB", value: "GB12345" }],
        billingContact: {
          name: "Ada Buyer",
          email: "owner@northstar.test",
        },
        apContact: null,
        invoiceDeliveryEmail: "invoices@northstar.test",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(verifyRegistration).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        workosUserId: "workos-user-1",
        domainVerifiedAt: "2026-07-31T16:00:00.000Z",
        registrationToken: undefined,
      }),
      expect.objectContaining({ actor: { kind: "user", id: "workos:user-1" } }),
    );
  });

  it("rejects a click-through outside the actor's account scope", async () => {
    const executeClickThrough = vi
      .fn()
      .mockResolvedValue({ id: "agreement-1", status: "active" });
    const response = await app({
      service: service({ executeClickThrough }),
    }).request("/v1/lifecycle/agreements/click-through", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        accountId: otherAccountId,
        templateId,
        templateVersion: "1.0.0",
        exactText: "Exact approved agreement text",
        exactTextHash: "a".repeat(64),
        authorityTitle: "Chief Executive Officer",
        authorityAttested: true,
        uiContext: {
          surface: "agreements",
          actionLabel: "I agree",
          locale: "en-US",
        },
        previousAgreementId: null,
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(executeClickThrough).not.toHaveBeenCalled();
  });

  it("passes identity, authority, network, UI, and idempotency evidence to the service", async () => {
    const executeClickThrough = vi
      .fn()
      .mockResolvedValue({ id: "agreement-1", status: "active" });
    const body = {
      accountId,
      templateId,
      templateVersion: "1.0.0",
      exactText: "Exact approved agreement text",
      exactTextHash: "a".repeat(64),
      authorityTitle: "Chief Executive Officer",
      authorityAttested: true,
      uiContext: {
        surface: "agreements",
        actionLabel: "I agree",
        locale: "en-US",
      },
      previousAgreementId: null,
    };
    const response = await app({
      service: service({ executeClickThrough }),
    }).request("/v1/lifecycle/agreements/click-through", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify(body),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(executeClickThrough).toHaveBeenCalledWith(
      body,
      expect.objectContaining({
        actor: { kind: "user", id: userId },
        idempotencyKey: "lifecycle-route-test-0001",
        ip: "192.0.2.10",
        userAgent: "Clockwork integration test",
      }),
    );
  });

  it("runs an authorized route through the transactional repository boundary", async () => {
    type TransactionInput = Parameters<
      LifecycleCommandRepository["executeInTransaction"]
    >[0];
    const calls: TransactionInput[] = [];
    const repository: LifecycleCommandRepository = {
      executeInTransaction(input) {
        calls.push(input);
        return Promise.resolve({ id: "agreement-1", status: "active" });
      },
    };
    const response = await app({
      service: new TransactionalLifecycleService(repository),
    }).request("/v1/lifecycle/agreements/click-through", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        accountId,
        templateId,
        templateVersion: "1.0.0",
        exactText: "Exact approved agreement text",
        exactTextHash: "a".repeat(64),
        authorityTitle: "Chief Executive Officer",
        authorityAttested: true,
        uiContext: {
          surface: "agreements",
          actionLabel: "I agree",
          locale: "en-US",
        },
        previousAgreementId: null,
      }),
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("execute_click_through");
    expect(calls[0]?.context.authorization?.accountIds).toContain(accountId);
    expect(calls[0]?.context.idempotencyKey).toBe("lifecycle-route-test-0001");
  });

  it("allows member-scoped resale users to accept only non-commercial pass-through terms", async () => {
    const acceptPassThroughTerms = vi
      .fn()
      .mockResolvedValue({ id: "acceptance-1", status: "active" });
    const response = await app({
      service: service({ acceptPassThroughTerms }),
      role: "member",
    }).request("/v1/lifecycle/end-user-terms/acceptances", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        accountId,
        organizationId,
        templateId,
        templateVersion: "1.0.0",
        exactTextHash: "b".repeat(64),
        uiContext: "first_login",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(acceptPassThroughTerms).toHaveBeenCalledOnce();
  });
});

describe("e-sign webhook boundary", () => {
  it("verifies the untouched raw body before claiming and deduplicates replay", async () => {
    const payload = {
      id: "evt-sign-1",
      type: "envelope.completed",
      envelopeId: "env-1",
    };
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        eventId: payload.id,
        occurredAt: "2026-07-31T16:00:00.000Z",
        payload,
      }),
    };
    const deduplicator = {
      claim: vi.fn().mockResolvedValue("duplicate" as const),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    };
    const ingestSignatureEvent = vi
      .fn()
      .mockResolvedValue({ id: "webhook-1", status: "accepted" });
    const lifecycleService = service({ ingestSignatureEvent });
    const rawBody = JSON.stringify(payload);
    const response = await app({
      service: lifecycleService,
      webhook: { verifier, deduplicator },
    }).request("/v1/webhooks/esign", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "esign-signature": "valid-signature",
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "duplicate" });
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: new TextEncoder().encode(rawBody),
        signature: "valid-signature",
      }),
    );
    expect(ingestSignatureEvent).not.toHaveBeenCalled();
  });
});
