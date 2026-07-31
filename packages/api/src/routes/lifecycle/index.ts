import type { Actor, Permission } from "@clockwork/contracts";
import { ids, ProblemError } from "@clockwork/contracts";
import { authorizationActor } from "@clockwork/domain";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  requirePermission,
  requireRecentAuthentication,
} from "../../auth/authorize";
import type { ApiVariables, RequestContext } from "../../context";
import { verifyAndClaimWebhook } from "../../webhooks";
import type {
  LifecycleOperationContext,
  LifecycleRouteDependencies,
  LifecycleRouteService,
} from "./types";

export * from "./events";
export * from "./service";
export * from "./types";

const operationResultSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    eventType: z.string().min(1).optional(),
  })
  .passthrough();
const operationResponses = {
  200: {
    description: "Lifecycle operation completed",
    content: { "application/json": { schema: operationResultSchema } },
  },
  403: { description: "Account, role, MFA, or recent-authentication denial" },
  503: { description: "Lifecycle persistence adapter is not configured" },
} as const;
const mutationHeaders = z.object({
  "idempotency-key": z.string().min(16).max(255),
});
const accountId = z.uuid();
const instant = z.iso.datetime({ offset: true });

const statusRoute = createRoute({
  method: "get",
  path: "/v1/lifecycle/status",
  tags: ["lifecycle"],
  responses: {
    200: {
      description: "Lifecycle-platform lane mount",
      content: {
        "application/json": {
          schema: z.object({
            lane: z.literal("lifecycle"),
            status: z.literal("ready"),
          }),
        },
      },
    },
  },
});

const registrationRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/registrations",
  tags: ["lifecycle", "onboarding"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              legalName: z.string().min(2),
              country: z.string().regex(/^[A-Z]{2}$/),
              registeredAddress: z.object({
                line1: z.string().min(1),
                line2: z.string().optional(),
                city: z.string().min(1),
                region: z.string().optional(),
                postalCode: z.string().min(1),
                country: z.string().regex(/^[A-Z]{2}$/),
              }),
              relationshipRoles: z
                .array(z.enum(["direct_client", "partner", "end_client"]))
                .min(1),
              businessDomain: z.string().min(3),
              registrantEmail: z.email(),
              registrationToken: z.string().min(32),
              taxIds: z
                .array(
                  z.object({
                    jurisdiction: z.string().regex(/^[A-Z]{2}$/),
                    value: z.string().min(3),
                  }),
                )
                .max(20),
              billingContact: z.object({ name: z.string(), email: z.email() }),
              apContact: z
                .object({ name: z.string(), email: z.email() })
                .nullable(),
              invoiceDeliveryEmail: z.email(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const membershipInviteRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/organizations/{organizationId}/invites",
  tags: ["lifecycle", "identity"],
  request: {
    headers: mutationHeaders,
    params: z.object({ organizationId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              email: z.email(),
              role: z.enum([
                "owner",
                "admin",
                "billing",
                "member",
                "partner_admin",
                "partner_seller",
              ]),
              expiresAt: instant,
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const accountSelectionRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/account-selection",
  tags: ["lifecycle", "identity"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ accountId }).strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const partnerDomainRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/partners/{accountId}/domains",
  tags: ["lifecycle", "identity", "partners"],
  request: {
    headers: mutationHeaders,
    params: z.object({ accountId }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              domain: z.string().min(3),
              verificationToken: z.string().min(16),
              brandName: z.string().min(1),
              logoUrl: z.url().nullable(),
              primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              communicationOwner: z.enum(["fil_one", "partner"]),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const procurementRoute = createRoute({
  method: "put",
  path: "/v1/lifecycle/accounts/{accountId}/procurement-profile",
  tags: ["lifecycle", "onboarding"],
  request: {
    headers: mutationHeaders,
    params: z.object({ accountId }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              apContact: z.object({ name: z.string(), email: z.email() }),
              invoiceDeliveryEmail: z.email(),
              poRequired: z.boolean(),
              exemptions: z.array(
                z.object({
                  jurisdiction: z.string().min(1),
                  certificateDocumentId: z.uuid(),
                  expiresOn: z.iso.date().nullable(),
                }),
              ),
              supplierDocuments: z.array(
                z.object({ kind: z.string(), documentId: z.uuid() }),
              ),
              buyerPortalTasks: z.array(
                z.object({
                  taskId: z.string().min(1),
                  ownerId: z.uuid(),
                  dueAt: instant,
                  reminderEveryHours: z.number().int().positive(),
                }),
              ),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const clickThroughRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/agreements/click-through",
  tags: ["lifecycle", "agreements"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              templateId: z.uuid(),
              templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
              exactText: z.string().min(1),
              exactTextHash: z.string().regex(/^[a-f0-9]{64}$/),
              authorityTitle: z.string().min(2),
              authorityAttested: z.literal(true),
              uiContext: z.object({
                surface: z.string().min(1),
                actionLabel: z.string().min(1),
                locale: z.string().min(2),
              }),
              previousAgreementId: z.uuid().nullable(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const agreementTemplateRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/agreement-templates",
  tags: ["lifecycle", "agreements"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              type: z.string().min(1),
              semanticVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
              jurisdiction: z.string().min(2),
              effectiveOn: z.iso.date(),
              canonicalDocumentId: z.uuid(),
              exactTextHash: z.string().regex(/^[a-f0-9]{64}$/),
              executionMode: z.enum(["click_through", "counter_signed"]),
              approvalEvidenceDocumentId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const customerPaperRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/agreements/customer-paper",
  tags: ["lifecycle", "agreements"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              uploadedDocumentId: z.uuid(),
              negotiationStatus: z.enum(["received", "redlining", "agreed"]),
              jurisdiction: z.string().min(2),
              keyTerms: z.record(z.string(), z.unknown()),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const envelopeRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/agreements/envelopes",
  tags: ["lifecycle", "agreements"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              agreementId: z.uuid(),
              documentId: z.uuid(),
              signerEmail: z.email(),
              mode: z.enum(["redirect", "embedded"]),
              returnUrl: z.url(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const esignWebhookRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/esign",
  tags: ["lifecycle", "webhooks"],
  request: {
    headers: z.object({ "esign-signature": z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.unknown() } },
    },
  },
  responses: {
    200: {
      description: "Verified e-sign callback processed or deduplicated",
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["processed", "duplicate"]) }),
        },
      },
    },
    503: { description: "Webhook adapter unavailable or already processing" },
  },
});

const provisioningWebhookRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/provisioning",
  tags: ["lifecycle", "webhooks", "provisioning"],
  request: {
    headers: z.object({ "provisioning-signature": z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.unknown() } },
    },
  },
  responses: {
    200: {
      description:
        "Verified provisioning confirmation processed or deduplicated",
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["processed", "duplicate"]) }),
        },
      },
    },
    503: { description: "Provisioning webhook adapter unavailable or busy" },
  },
});

const marketplaceWebhookRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/marketplaces-platform",
  tags: ["lifecycle", "webhooks", "marketplaces"],
  request: {
    headers: z.object({ "marketplace-signature": z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.unknown() } },
    },
  },
  responses: {
    200: {
      description:
        "Verified marketplace entitlement event processed or deduplicated",
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["processed", "duplicate"]) }),
        },
      },
    },
    503: { description: "Marketplace webhook adapter unavailable or busy" },
  },
});

const pocConversionRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/pocs/{pocId}/conversion",
  tags: ["lifecycle", "pocs"],
  request: {
    headers: mutationHeaders,
    params: z.object({ pocId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              quoteId: z.uuid(),
              orderId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const pocCreateRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/pocs",
  tags: ["lifecycle", "pocs"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              partnerAccountId: accountId.nullable(),
              workload: z.string().min(8),
              buyerUserId: z.uuid(),
              permittedDataClass: z.string().min(1),
              successTests: z
                .array(z.object({ id: z.string(), description: z.string() }))
                .min(1),
              capacityCap: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/),
              egressCap: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/),
              expiresAt: instant,
              supportOwnerId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const pocDecisionRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/pocs/{pocId}/decisions",
  tags: ["lifecycle", "pocs", "exceptions"],
  request: {
    headers: mutationHeaders,
    params: z.object({ pocId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            decision: z.enum(["approved", "rejected"]),
            reason: z.string().min(8),
            evidenceDocumentId: z.uuid(),
          }),
        },
      },
    },
  },
  responses: operationResponses,
});

const provisioningRecoveryRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/provisioning/{commandId}/recover",
  tags: ["lifecycle", "provisioning"],
  request: {
    headers: mutationHeaders,
    params: z.object({ commandId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ reason: z.string().min(8) }).strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const passThroughRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/end-user-terms/acceptances",
  tags: ["lifecycle", "agreements"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              organizationId: z.uuid(),
              templateId: z.uuid(),
              templateVersion: z.string(),
              exactTextHash: z.string().regex(/^[a-f0-9]{64}$/),
              uiContext: z.string().min(1),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const inboundNoticeRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/notices",
  tags: ["lifecycle", "renewals"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              orderId: z.uuid(),
              type: z.enum([
                "non_renewal",
                "termination",
                "breach_claim",
                "other",
              ]),
              servedOn: z.iso.date(),
              evidenceDocumentId: z.uuid(),
              source: z.enum(["portal", "email", "mail", "esign"]),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const renewalCommandCenterRoute = createRoute({
  method: "get",
  path: "/v1/lifecycle/renewals",
  tags: ["lifecycle", "renewals"],
  request: {
    query: z.object({
      accountId: accountId.optional(),
      window: z.enum(["30", "60_90", "180", "all"]).default("all"),
      timeZone: z.string().min(1).default("UTC"),
    }),
  },
  responses: operationResponses,
});

const renewalRequestRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/renewals/{orderId}/requests",
  tags: ["lifecycle", "renewals"],
  request: {
    headers: mutationHeaders,
    params: z.object({ orderId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              requestedAction: z.enum([
                "renew",
                "change_term",
                "request_change",
              ]),
              requestedTermMonths: z.number().int().positive().nullable(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const renewalDeclineRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/renewals/{orderId}/declines",
  tags: ["lifecycle", "renewals"],
  request: {
    headers: mutationHeaders,
    params: z.object({ orderId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              reason: z.string().min(1),
              authorityTitle: z.string().min(2),
              authorityAttested: z.literal(true),
              evidenceDocumentId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const terminationRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/terminations",
  tags: ["lifecycle", "offboarding"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              orderId: z.uuid(),
              reason: z.enum([
                "customer_request",
                "non_renewal",
                "partner_request",
                "partner_default",
                "material_breach",
              ]),
              effectiveAt: instant,
              retrievalDays: z.number().int().positive(),
              partnerAccountId: accountId.nullable(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const terminationApprovalRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/terminations/{terminationId}/approvals",
  tags: ["lifecycle", "offboarding"],
  request: {
    headers: mutationHeaders,
    params: z.object({ terminationId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              decision: z.enum(["approved", "rejected"]),
              reason: z.string().min(8),
              evidenceDocumentId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const exceptionDecisionRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/exceptions/{caseId}/decisions",
  tags: ["lifecycle", "exceptions"],
  request: {
    headers: mutationHeaders,
    params: z.object({ caseId: z.uuid() }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              queue: z.enum([
                "pricing",
                "legal",
                "credit_collections",
                "restricted_parties",
                "disputes",
                "deal_registration_disputes",
                "poc_qualification",
              ]),
              decision: z.enum(["approved", "rejected"]),
              reason: z.string().min(8),
              evidenceDocumentId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const novationRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/novations",
  tags: ["lifecycle", "offboarding"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId,
              formerPartnerAccountId: accountId,
              sourceOrderId: z.uuid(),
              newAgreementId: z.uuid(),
              newOrderId: z.uuid(),
              reason: z.enum([
                "partner_default",
                "partner_exit",
                "agreed_handoff",
              ]),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const exceptionOpenRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/exceptions",
  tags: ["lifecycle", "exceptions"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId: accountId.nullable(),
              queue: z.enum([
                "pricing",
                "legal",
                "credit_collections",
                "restricted_parties",
                "disputes",
                "deal_registration_disputes",
                "poc_qualification",
              ]),
              objectType: z.string().min(1),
              objectId: z.uuid(),
              reason: z.string().min(8),
              evidenceDocumentId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const supportSignalsRoute = createRoute({
  method: "get",
  path: "/v1/lifecycle/accounts/{accountId}/support-signals",
  tags: ["lifecycle", "support"],
  request: {
    params: z.object({ accountId }),
    query: z.object({ since: instant.optional() }),
  },
  responses: operationResponses,
});

const migrationRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/migrations",
  tags: ["lifecycle", "migrations"],
  request: {
    headers: mutationHeaders,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              executionMode: z.enum(["discovery", "rehearsal", "execute"]),
              sourceSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
              resumeRunId: z.uuid().nullable(),
              batchSize: z.number().int().min(1).max(100),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

const migrationMatchDecisionRoute = createRoute({
  method: "post",
  path: "/v1/lifecycle/migrations/{runId}/matches/{legacyAccountId}/decision",
  tags: ["lifecycle", "migrations", "exceptions"],
  request: {
    headers: mutationHeaders,
    params: z.object({ runId: z.uuid(), legacyAccountId: z.string().min(1) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              decision: z.enum(["create", "attach", "skip"]),
              accountId: accountId.nullable(),
              reason: z.string().min(8),
              evidenceDocumentId: z.uuid(),
            })
            .strict(),
        },
      },
    },
  },
  responses: operationResponses,
});

function serviceOrThrow(
  dependencies: LifecycleRouteDependencies,
  request: RequestContext,
): LifecycleRouteService {
  if (dependencies.service) return dependencies.service;
  throw new ProblemError({
    type: "https://clockwork.test/problems/lifecycle-adapter",
    title: "Lifecycle persistence adapter unavailable",
    status: 503,
    code: "LIFECYCLE_ADAPTER_UNAVAILABLE",
    requestId: request.requestId,
    retryable: true,
  });
}

function operationContext(
  request: RequestContext,
  idempotencyKey: string | null,
  actorOverride?: Actor,
): LifecycleOperationContext {
  const actor =
    actorOverride ??
    (request.authorization
      ? authorizationActor(request.authorization)
      : undefined);
  if (!actor) throw new Error("Authorization context missing");
  return {
    requestId: request.requestId,
    actor,
    idempotencyKey,
    ip: request.ip,
    userAgent: request.userAgent,
    occurredAt: request.receivedAt.toISOString(),
    authorization: request.authorization,
  };
}

function idempotencyKey(headers: { "idempotency-key": string }): string {
  return headers["idempotency-key"];
}

const queuePermission: Record<string, Permission> = {
  pricing: "quote:approve",
  legal: "agreement:approve",
  credit_collections: "billing:approve",
  restricted_parties: "agreement:approve",
  disputes: "billing:approve",
  deal_registration_disputes: "system:operate",
  poc_qualification: "poc:manage",
};

export function registerLifecycleRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
  dependencies: LifecycleRouteDependencies = {},
): void {
  app.openapi(statusRoute, (context) =>
    context.json({ lane: "lifecycle", status: "ready" }),
  );

  app.openapi(registrationRoute, async (context) => {
    const request = context.get("requestContext");
    const bootstrap = dependencies.registrationBootstrap;
    if (!bootstrap)
      throw new ProblemError({
        type: "https://clockwork.test/problems/registration-bootstrap",
        title: "Registration bootstrap is unavailable",
        status: 503,
        code: "REGISTRATION_BOOTSTRAP_UNAVAILABLE",
        requestId: request.requestId,
        retryable: true,
      });
    const body = context.req.valid("json");
    const verified = await bootstrap.verify({
      token: body.registrationToken,
      email: body.registrantEmail,
      businessDomain: body.businessDomain,
      requestId: request.requestId,
    });
    const verifiedBody = { ...body, registrationToken: undefined };
    return context.json(
      await serviceOrThrow(dependencies, request).register(
        {
          ...verifiedBody,
          workosUserId: verified.workosUserId,
          domainVerifiedAt: verified.domainVerifiedAt,
        },
        operationContext(
          request,
          idempotencyKey(context.req.valid("header")),
          verified.actor,
        ),
      ),
      200,
    );
  });

  app.openapi(membershipInviteRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "account:write",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).inviteMember(
        { ...body, organizationId: context.req.valid("param").organizationId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(accountSelectionRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "account:read",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).switchAccount(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(partnerDomainRoute, async (context) => {
    const params = context.req.valid("param");
    requirePermission(
      context,
      "account:write",
      ids.account.parse(params.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).verifyPartnerDomain(
        { ...context.req.valid("json"), accountId: params.accountId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(procurementRoute, async (context) => {
    const params = context.req.valid("param");
    requirePermission(
      context,
      "account:write",
      ids.account.parse(params.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).updateProcurement(
        { ...context.req.valid("json"), accountId: params.accountId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(agreementTemplateRoute, async (context) => {
    requirePermission(context, "agreement:approve");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).publishAgreementTemplate(
        context.req.valid("json"),
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(customerPaperRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "agreement:execute",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).uploadCustomerPaper(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(clickThroughRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "agreement:execute",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).executeClickThrough(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(envelopeRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "agreement:execute",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).createSignatureEnvelope(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(esignWebhookRoute, async (context) => {
    const adapter = dependencies.esignWebhook;
    if (!adapter || !dependencies.service)
      return context.json(
        { title: "E-sign webhook is not configured", status: 503 },
        503,
      );
    const request = context.get("requestContext");
    const rawBody = request.rawWebhookBody;
    if (!rawBody) throw new Error("Verified webhook raw body was not captured");
    const unverified = z
      .object({ type: z.string().min(1) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(rawBody)));
    const result = await verifyAndClaimWebhook({
      provider: "esign",
      eventType: unverified.type,
      rawBody,
      signature: context.req.valid("header")["esign-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim === "in_progress")
      return context.json(
        { title: "E-sign event already in progress", status: 503 },
        503,
      );
    try {
      await dependencies.service.ingestSignatureEvent(result.verified.payload, {
        requestId: request.requestId,
        actor: { kind: "provider", id: "esign" },
        idempotencyKey: `esign:${result.verified.eventId}`,
        ip: request.ip,
        userAgent: request.userAgent,
        occurredAt: result.verified.occurredAt,
        authorization: null,
      });
      await adapter.deduplicator.markProcessed(
        "esign",
        result.verified.eventId,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "esign",
        result.verified.eventId,
        error instanceof Error
          ? error.message
          : "Unknown e-sign webhook failure",
      );
      throw error;
    }
    return context.json({ status: "processed" as const }, 200);
  });

  app.openapi(provisioningWebhookRoute, async (context) => {
    const adapter = dependencies.provisioningWebhook;
    if (!adapter || !dependencies.service)
      return context.json(
        { title: "Provisioning webhook is not configured", status: 503 },
        503,
      );
    const request = context.get("requestContext");
    const rawBody = request.rawWebhookBody;
    if (!rawBody) throw new Error("Verified webhook raw body was not captured");
    const unverified = z
      .object({ type: z.string().min(1) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(rawBody)));
    const result = await verifyAndClaimWebhook({
      provider: "provisioning",
      eventType: unverified.type,
      rawBody,
      signature: context.req.valid("header")["provisioning-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim === "in_progress")
      return context.json(
        { title: "Provisioning event already in progress", status: 503 },
        503,
      );
    try {
      await dependencies.service.ingestProvisioningEvent(
        result.verified.payload,
        {
          requestId: request.requestId,
          actor: { kind: "provider", id: "provisioning" },
          idempotencyKey: `provisioning:${result.verified.eventId}`,
          ip: request.ip,
          userAgent: request.userAgent,
          occurredAt: result.verified.occurredAt,
          authorization: null,
        },
      );
      await adapter.deduplicator.markProcessed(
        "provisioning",
        result.verified.eventId,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "provisioning",
        result.verified.eventId,
        error instanceof Error
          ? error.message
          : "Unknown provisioning webhook failure",
      );
      throw error;
    }
    return context.json({ status: "processed" as const }, 200);
  });

  app.openapi(marketplaceWebhookRoute, async (context) => {
    const adapter = dependencies.marketplaceWebhook;
    if (!adapter || !dependencies.service)
      return context.json(
        { title: "Marketplace webhook is not configured", status: 503 },
        503,
      );
    const request = context.get("requestContext");
    const rawBody = request.rawWebhookBody;
    if (!rawBody) throw new Error("Verified webhook raw body was not captured");
    const unverified = z
      .object({ type: z.string().min(1) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(rawBody)));
    const result = await verifyAndClaimWebhook({
      provider: "marketplaces-platform",
      eventType: unverified.type,
      rawBody,
      signature: context.req.valid("header")["marketplace-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim === "in_progress")
      return context.json(
        { title: "Marketplace event already in progress", status: 503 },
        503,
      );
    try {
      await dependencies.service.ingestMarketplaceEvent(
        result.verified.payload,
        {
          requestId: request.requestId,
          actor: { kind: "provider", id: "marketplaces-platform" },
          idempotencyKey: `marketplaces-platform:${result.verified.eventId}`,
          ip: request.ip,
          userAgent: request.userAgent,
          occurredAt: result.verified.occurredAt,
          authorization: null,
        },
      );
      await adapter.deduplicator.markProcessed(
        "marketplaces-platform",
        result.verified.eventId,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "marketplaces-platform",
        result.verified.eventId,
        error instanceof Error
          ? error.message
          : "Unknown marketplace webhook failure",
      );
      throw error;
    }
    return context.json({ status: "processed" as const }, 200);
  });

  app.openapi(pocConversionRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(context, "poc:manage", ids.account.parse(body.accountId));
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).convertPoc(
        { ...body, pocId: context.req.valid("param").pocId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(pocCreateRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(context, "poc:manage", ids.account.parse(body.accountId));
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).createPoc(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(pocDecisionRoute, async (context) => {
    requirePermission(context, "poc:manage");
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).decidePoc(
        {
          ...context.req.valid("json"),
          pocId: context.req.valid("param").pocId,
        },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(provisioningRecoveryRoute, async (context) => {
    requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).recoverProvisioning(
        {
          ...context.req.valid("json"),
          commandId: context.req.valid("param").commandId,
        },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(passThroughRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "agreement:read",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).acceptPassThroughTerms(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(inboundNoticeRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "order:write",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).recordInboundNotice(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(renewalCommandCenterRoute, async (context) => {
    const query = context.req.valid("query");
    requirePermission(
      context,
      "report:read",
      query.accountId ? ids.account.parse(query.accountId) : undefined,
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).renewalCommandCenter(
        query,
        operationContext(request, null),
      ),
      200,
    );
  });

  app.openapi(renewalRequestRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "order:write",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).requestRenewal(
        { ...body, orderId: context.req.valid("param").orderId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(renewalDeclineRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "order:write",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).declineRenewal(
        { ...body, orderId: context.req.valid("param").orderId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(terminationRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "destructive:request",
      ids.account.parse(body.accountId),
    );
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).requestTermination(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(terminationApprovalRoute, async (context) => {
    requirePermission(context, "destructive:approve");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).decideTermination(
        {
          ...context.req.valid("json"),
          terminationId: context.req.valid("param").terminationId,
        },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(exceptionDecisionRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(context, queuePermission[body.queue] ?? "system:operate");
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).decideException(
        { ...body, caseId: context.req.valid("param").caseId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(novationRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(
      context,
      "destructive:request",
      ids.account.parse(body.accountId),
    );
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).createNovation(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(exceptionOpenRoute, async (context) => {
    const body = context.req.valid("json");
    requirePermission(context, queuePermission[body.queue] ?? "system:operate");
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).openException(
        body,
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(supportSignalsRoute, async (context) => {
    const params = context.req.valid("param");
    requirePermission(
      context,
      "account:read",
      ids.account.parse(params.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).listSupportSignals(
        { accountId: params.accountId, ...context.req.valid("query") },
        operationContext(request, null),
      ),
      200,
    );
  });

  app.openapi(migrationRoute, async (context) => {
    requirePermission(context, "destructive:request");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).startMigration(
        context.req.valid("json"),
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(migrationMatchDecisionRoute, async (context) => {
    requirePermission(context, "destructive:approve");
    requireRecentAuthentication(context);
    const request = context.get("requestContext");
    return context.json(
      await serviceOrThrow(dependencies, request).decideMigrationMatch(
        { ...context.req.valid("json"), ...context.req.valid("param") },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });
}
