import { ProblemError } from "@clockwork/contracts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import { sessionMiddleware } from "../../auth/session";
import type { ApiVariables } from "../../context";
import { requestContextMiddleware } from "../../middleware/request-context";
import { registerLifecycleRoutes, TransactionalLifecycleService } from ".";
import type {
  LifecycleAuthorizationScopeResolver,
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
  marketplaceWebhook?: LifecycleRouteDependencies["marketplaceWebhook"];
  supportWebhook?: LifecycleRouteDependencies["supportWebhook"];
  registrationBootstrap?: LifecycleRouteDependencies["registrationBootstrap"];
  partnerDomainOwnership?: LifecycleRouteDependencies["partnerDomainOwnership"];
  authorizationScopes?: LifecycleAuthorizationScopeResolver;
}) {
  const app = new OpenAPIHono<{ Variables: ApiVariables }>();
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(
        error.problem,
        error.problem.status as 403 | 422 | 503,
      );
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
    ...(input.marketplaceWebhook
      ? { marketplaceWebhook: input.marketplaceWebhook }
      : {}),
    ...(input.supportWebhook ? { supportWebhook: input.supportWebhook } : {}),
    ...(input.registrationBootstrap
      ? { registrationBootstrap: input.registrationBootstrap }
      : {}),
    ...(input.partnerDomainOwnership
      ? { partnerDomainOwnership: input.partnerDomainOwnership }
      : {}),
    ...(input.authorizationScopes
      ? { authorizationScopes: input.authorizationScopes }
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
  it("rejects a whitespace-only POC success-test target at the API boundary", async () => {
    const createPoc = vi.fn();
    const response = await app({ service: service({ createPoc }) }).request(
      "/v1/lifecycle/pocs",
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          accountId,
          partnerAccountId: null,
          workload: "Restore validation workload",
          buyerUserId: userId,
          permittedDataClass: "synthetic",
          successTests: [
            {
              id: "restore",
              description: "Restore succeeds",
              target: "   ",
            },
          ],
          capacityCap: "40",
          egressCap: "2",
          expiresAt: "2026-08-31T16:00:00.000Z",
          supportOwnerId: userId,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(createPoc).not.toHaveBeenCalled();
  });

  it("fails closed without server-observed domain proof and injects verified evidence", async () => {
    const verifyPartnerDomain = vi
      .fn()
      .mockResolvedValue({ id: "domain-1", status: "verified" });
    const body = {
      domain: "brand.northstar.example",
      verificationToken: "domain-proof-token-123456",
      brandName: "Northstar",
      logoUrl: null,
      primaryColor: "#123456",
      communicationOwner: "fil_one" as const,
    };
    const missing = await app({
      service: service({ verifyPartnerDomain }),
    }).request(`/v1/lifecycle/partners/${accountId}/domains`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify(body),
    });
    expect(missing.status).toBe(503);
    expect(verifyPartnerDomain).not.toHaveBeenCalled();

    const verifier = {
      verify: vi.fn().mockResolvedValue({
        verifiedAt: "2026-07-31T16:00:00.000Z",
        evidenceReference: "dns-txt:_clockwork-domain.brand.northstar.example",
      }),
    };
    const verified = await app({
      service: service({ verifyPartnerDomain }),
      partnerDomainOwnership: verifier,
    }).request(`/v1/lifecycle/partners/${accountId}/domains`, {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify(body),
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: body.domain,
        verificationToken: body.verificationToken,
      }),
    );
    expect(verifyPartnerDomain).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        verificationEvidence: {
          verifiedAt: "2026-07-31T16:00:00.000Z",
          evidenceReference:
            "dns-txt:_clockwork-domain.brand.northstar.example",
        },
      }),
      expect.anything(),
    );
  });

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
    await expect(response.json()).resolves.toMatchObject({
      code: "CROSS_ACCOUNT_DENIED",
    });
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
        ip: null,
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

  it("derives POC decision scope from the persisted POC", async () => {
    const decidePoc = vi
      .fn()
      .mockResolvedValue({ id: "poc-decision-1", status: "approved" });
    const response = await app({
      service: service({ decidePoc }),
      authorizationScopes: {
        resolvePocAccount: vi.fn().mockResolvedValue({
          accountId: otherAccountId,
        }),
        resolveExceptionScope: vi.fn(),
        resolveOrderScope: vi.fn(),
      },
    }).request(
      "/v1/lifecycle/pocs/50000000-0000-4000-8000-000000000001/decisions",
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          decision: "approved",
          reason: "Success criteria passed",
          evidenceDocumentId: "60000000-0000-4000-8000-000000000001",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(decidePoc).not.toHaveBeenCalled();
  });

  it("derives exception queue authority instead of trusting the request", async () => {
    const decideException = vi
      .fn()
      .mockResolvedValue({ id: "exception-1", status: "approved" });
    const response = await app({
      service: service({ decideException }),
      authorizationScopes: {
        resolvePocAccount: vi.fn(),
        resolveExceptionScope: vi.fn().mockResolvedValue({
          accountId,
          queue: "legal",
        }),
        resolveOrderScope: vi.fn(),
      },
    }).request(
      "/v1/lifecycle/exceptions/70000000-0000-4000-8000-000000000001/decisions",
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          decision: "approved",
          reason: "Counsel reviewed evidence",
          evidenceDocumentId: "60000000-0000-4000-8000-000000000002",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(decideException).not.toHaveBeenCalled();
  });

  it("authorizes partner-MoR offboarding from the persisted order scope", async () => {
    const requestRenewal = vi
      .fn()
      .mockResolvedValue({ id: "renewal-1", status: "accepted" });
    const declineRenewal = vi
      .fn()
      .mockResolvedValue({ id: "decline-1", status: "accepted" });
    const requestTermination = vi
      .fn()
      .mockResolvedValue({ id: "termination-1", status: "requested" });
    const orderId = "50000000-0000-4000-8000-000000000090";
    const resolver: LifecycleAuthorizationScopeResolver = {
      resolvePocAccount: vi.fn(),
      resolveExceptionScope: vi.fn(),
      resolveOrderScope: vi.fn().mockResolvedValue({
        accountId: otherAccountId,
        partnerAccountId: accountId,
        authorizationAccountId: accountId,
      }),
    };
    const configured = app({
      service: service({ requestRenewal, declineRenewal, requestTermination }),
      authorizationScopes: resolver,
    });

    const renewal = await configured.request(
      `/v1/lifecycle/renewals/${orderId}/requests`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          accountId,
          requestedAction: "renew",
          requestedTermMonths: 12,
        }),
      },
    );
    expect(renewal.status, await renewal.clone().text()).toBe(200);
    expect(requestRenewal).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: otherAccountId, orderId }),
      expect.anything(),
    );

    const decline = await configured.request(
      `/v1/lifecycle/renewals/${orderId}/declines`,
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          accountId,
          reason: "End client requested non-renewal",
          authorityTitle: "Partner administrator",
          authorityAttested: true,
          evidenceDocumentId: "60000000-0000-4000-8000-000000000090",
        }),
      },
    );
    expect(decline.status, await decline.clone().text()).toBe(200);
    expect(declineRenewal).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: otherAccountId, orderId }),
      expect.anything(),
    );

    const termination = await configured.request("/v1/lifecycle/terminations", {
      method: "POST",
      headers: mutationHeaders,
      body: JSON.stringify({
        accountId,
        orderId,
        reason: "partner_request",
        effectiveAt: "2026-08-31T00:00:00.000Z",
        retrievalDays: 30,
        partnerAccountId: null,
      }),
    });
    expect(termination.status, await termination.clone().text()).toBe(200);
    expect(requestTermination).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: otherAccountId,
        partnerAccountId: accountId,
        orderId,
      }),
      expect.anything(),
    );
  });

  it("rejects an unrelated tenant before partner-MoR offboarding", async () => {
    const declineRenewal = vi.fn();
    const response = await app({
      service: service({ declineRenewal }),
      authorizationScopes: {
        resolvePocAccount: vi.fn(),
        resolveExceptionScope: vi.fn(),
        resolveOrderScope: vi.fn().mockResolvedValue({
          accountId,
          partnerAccountId: otherAccountId,
          authorizationAccountId: otherAccountId,
        }),
      },
    }).request(
      "/v1/lifecycle/renewals/50000000-0000-4000-8000-000000000091/declines",
      {
        method: "POST",
        headers: mutationHeaders,
        body: JSON.stringify({
          accountId,
          reason: "Forged partner request",
          authorityTitle: "Partner administrator",
          authorityAttested: true,
          evidenceDocumentId: "60000000-0000-4000-8000-000000000091",
        }),
      },
    );
    expect(response.status).toBe(403);
    expect(declineRenewal).not.toHaveBeenCalled();
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
      claim: vi.fn().mockResolvedValue({ status: "duplicate" as const }),
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

describe("marketplace webhook boundary", () => {
  it("binds the provider path before claiming and sends the canonical payload", async () => {
    const payload = {
      type: "entitlement.activated",
      eventId: "mp-event-1",
      provider: "aws",
      providerAccountReference: "seller-1",
      accountId,
      orderId: "50000000-0000-4000-8000-000000000001",
      entitlementId: "60000000-0000-4000-8000-000000000001",
      occurredAt: "2026-07-31T16:00:00.000Z",
      currency: null,
      grossMinor: null,
      feeMinor: null,
      taxMinor: null,
      netMinor: null,
      quantity: "5",
      sequence: 1,
    };
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        eventId: payload.eventId,
        occurredAt: payload.occurredAt,
        payload,
      }),
    };
    const deduplicator = {
      claim: vi.fn().mockResolvedValue({
        status: "claimed" as const,
        claimToken: "claim-1",
      }),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    };
    const ingestMarketplaceEvent = vi
      .fn()
      .mockResolvedValue({ id: payload.eventId, status: "processed" });
    const lifecycleService = service({ ingestMarketplaceEvent });
    const configured = app({
      service: lifecycleService,
      marketplaceWebhook: { verifier, deduplicator },
    });
    const request = (provider: string) =>
      configured.request(`/v1/webhooks/marketplaces/${provider}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "marketplace-signature": "valid-signature",
        },
        body: JSON.stringify({ provider }),
      });

    const mismatch = await request("azure");
    expect(mismatch.status).toBe(422);
    await expect(mismatch.json()).resolves.toMatchObject({
      code: "MARKETPLACE_PROVIDER_MISMATCH",
    });
    expect(deduplicator.claim).not.toHaveBeenCalled();

    const response = await request("aws");
    expect(response.status).toBe(200);
    expect(deduplicator.claim).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "marketplace:aws" }),
    );
    expect(ingestMarketplaceEvent).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({
        actor: { kind: "provider", id: "marketplace:aws" },
      }),
    );
    expect(deduplicator.markProcessed).toHaveBeenCalledWith(
      "marketplace:aws",
      payload.eventId,
      "claim-1",
    );
  });

  it.each([
    ["money overflow", { grossMinor: "9223372036854775808" }],
    ["negative quantity", { quantity: "-1" }],
    ["exponent quantity", { quantity: "1e3" }],
    ["over-precision quantity", { quantity: "0.0000000000000000001" }],
  ])(
    "rejects %s before claiming or calling persistence",
    async (_label, override) => {
      const payload = {
        type: "entitlement.activated",
        eventId: "mp-event-invalid-1",
        provider: "aws" as const,
        providerAccountReference: "seller-1",
        accountId,
        orderId: "50000000-0000-4000-8000-000000000001",
        entitlementId: "60000000-0000-4000-8000-000000000001",
        occurredAt: "2026-07-31T16:00:00.000Z",
        currency: "USD" as const,
        grossMinor: "1",
        feeMinor: "0",
        taxMinor: "0",
        netMinor: "1",
        quantity: "5",
        sequence: 1,
        ...override,
      };
      const verifier = {
        verify: vi.fn().mockResolvedValue({
          eventId: payload.eventId,
          occurredAt: payload.occurredAt,
          payload,
        }),
      };
      const deduplicator = {
        claim: vi.fn(),
        markProcessed: vi.fn(),
        markFailed: vi.fn(),
      };
      const ingestMarketplaceEvent = vi.fn();
      const configured = app({
        service: service({ ingestMarketplaceEvent }),
        marketplaceWebhook: { verifier, deduplicator },
      });

      const response = await configured.request(
        "/v1/webhooks/marketplaces/aws",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "marketplace-signature": "valid-signature",
          },
          body: JSON.stringify({ provider: "aws" }),
        },
      );

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "MARKETPLACE_PAYLOAD_INVALID",
        status: 422,
      });
      expect(deduplicator.claim).not.toHaveBeenCalled();
      expect(ingestMarketplaceEvent).not.toHaveBeenCalled();
    },
  );
});

describe("support webhook boundary", () => {
  it("records only verified metadata and binds the provider path before claim", async () => {
    const payload = {
      type: "support.signal.updated",
      eventId: "support-event-1",
      provider: "zendesk",
      accountId,
      externalSignalId: "ticket-1",
      sequence: 2,
      severity: "high",
      category: "provisioning",
      status: "open",
      occurredAt: "2026-08-01T12:00:00.000Z",
    };
    const verifier = {
      verify: vi.fn().mockResolvedValue({
        eventId: payload.eventId,
        occurredAt: payload.occurredAt,
        payload,
      }),
    };
    const deduplicator = {
      claim: vi.fn().mockResolvedValue({
        status: "claimed" as const,
        claimToken: "support-claim-1",
      }),
      markProcessed: vi.fn(),
      markFailed: vi.fn(),
    };
    const listSupportSignals =
      vi.fn<LifecycleRouteService["listSupportSignals"]>();
    const lifecycleService = service({ listSupportSignals });
    const configured = app({
      service: lifecycleService,
      supportWebhook: { verifier, deduplicator },
    });
    const request = (provider: string) =>
      configured.request(`/v1/webhooks/support/${provider}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "support-signature": "valid-signature",
        },
        body: JSON.stringify({ provider, summary: "must-not-persist" }),
      });

    const mismatched = await request("freshdesk");
    expect(mismatched.status).toBe(422);
    await expect(mismatched.json()).resolves.toMatchObject({
      code: "SUPPORT_PROVIDER_MISMATCH",
      status: 422,
    });
    expect(deduplicator.claim).not.toHaveBeenCalled();
    expect((await request("zendesk")).status).toBe(200);
    expect(deduplicator.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "support:zendesk",
        payload,
      }),
    );
    expect(deduplicator.markProcessed).toHaveBeenCalledWith(
      "support:zendesk",
      payload.eventId,
      "support-claim-1",
    );
    expect(listSupportSignals).not.toHaveBeenCalled();
  });
});
