import type {
  Actor,
  MarketplaceEventPayload,
  Permission,
} from "@clockwork/contracts";
import {
  ids,
  MarketplaceEventPayloadSchema,
  ProblemError,
} from "@clockwork/contracts";
import {
  authorizationActor,
  unscopedBecause,
  unscopedInternalOnly,
  unscopedInternalStaff,
} from "@clockwork/domain";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  requirePermission,
  requireRecentAuthentication,
} from "../../auth/authorize";
import type { ApiVariables, RequestContext } from "../../context";
import { registerNotificationRoutes } from "./notifications";
import { verifyAndClaimWebhook } from "../../webhooks";
import type {
  LifecycleAuthorizationScopeResolver,
  LifecycleExceptionQueue,
  LifecycleOperationContext,
  LifecycleRouteDependencies,
  LifecycleRouteService,
} from "./types";

export * from "./events";
export * from "./notifications";
export * from "./service";
export * from "./types";

const operationResultSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    eventType: z.string().min(1).optional(),
    signingUrl: z.url().optional(),
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
            status: z.enum(["ready", "degraded", "unavailable"]),
            details: z.object({
              service: z.enum(["database", "missing"]),
              registration: z.enum(["configured", "missing"]),
              partnerDomainOwnership: z.enum(["configured", "missing"]),
              esign: z.enum(["configured", "missing"]),
              provisioningWebhook: z.enum(["configured", "missing"]),
              marketplaceWebhook: z.enum(["configured", "missing"]),
              supportWebhook: z.enum(["configured", "missing"]),
              evidenceStorage: z.enum(["configured", "missing"]),
            }),
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
              exactText: z.string().min(1),
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

const activeAgreementTemplateRoute = createRoute({
  method: "get",
  path: "/v1/lifecycle/agreement-templates/active",
  tags: ["lifecycle", "agreements"],
  request: {
    query: z.object({
      type: z.string().min(1).max(80),
      jurisdiction: z.string().min(2).max(20),
    }),
  },
  responses: {
    200: {
      description:
        "Active approved agreement template with verified exact text",
      content: {
        "application/json": {
          schema: z.object({
            id: z.uuid(),
            type: z.string(),
            semanticVersion: z.string(),
            jurisdiction: z.string(),
            effectiveOn: z.iso.date(),
            canonicalDocumentId: z.uuid(),
            exactText: z.string().min(1),
            exactTextHash: z.string().regex(/^[a-f0-9]{64}$/),
            executionMode: z.enum(["click_through", "counter_signed"]),
          }),
        },
      },
    },
    403: { description: "Agreement read permission denied" },
    404: { description: "Active approved template not found" },
    503: { description: "Template evidence storage is not configured" },
  },
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
  path: "/v1/webhooks/marketplaces/{provider}",
  tags: ["lifecycle", "webhooks", "marketplaces"],
  request: {
    params: z.object({ provider: z.enum(["aws", "azure", "google"]) }),
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

const supportWebhookRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/support/{provider}",
  tags: ["lifecycle", "webhooks", "support"],
  request: {
    params: z.object({
      provider: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    }),
    headers: z.object({ "support-signature": z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.unknown() } },
    },
  },
  responses: {
    200: {
      description: "Verified support signal metadata recorded or deduplicated",
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["processed", "duplicate"]) }),
        },
      },
    },
    422: { description: "Verified support provider does not match the path" },
    503: { description: "Support webhook adapter unavailable or busy" },
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
                .array(
                  z.object({
                    id: z.string(),
                    description: z.string(),
                    target: z.string().trim().min(1),
                  }),
                )
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

function authorizationScopesOrThrow(
  dependencies: LifecycleRouteDependencies,
  request: RequestContext,
): LifecycleAuthorizationScopeResolver {
  if (dependencies.authorizationScopes) return dependencies.authorizationScopes;
  throw new ProblemError({
    type: "https://clockwork.test/problems/lifecycle-authorization-scope",
    title: "Lifecycle authorization scope adapter unavailable",
    status: 503,
    code: "LIFECYCLE_AUTHORIZATION_SCOPE_UNAVAILABLE",
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

function assertSigningReturnUrl(value: string, requestId: string): void {
  const allowed = new Set(
    [
      process.env.APP_ORIGIN ??
        process.env.NEXT_PUBLIC_APP_URL ??
        "http://localhost:3000",
      ...(process.env.ESIGN_RETURN_ORIGINS ?? "").split(","),
    ]
      .filter((item): item is string => Boolean(item?.trim()))
      .map((item) => new URL(item.trim()).origin),
  );
  if (!allowed.has(new URL(value).origin))
    throw new ProblemError({
      type: "https://clockwork.test/problems/esign-return-origin",
      title: "E-sign return URL is not allowed",
      status: 403,
      code: "ESIGN_RETURN_ORIGIN_REJECTED",
      requestId,
      retryable: false,
    });
}

const queuePermission: Record<LifecycleExceptionQueue, Permission> = {
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
  registerNotificationRoutes(app, {
    ...(dependencies.notificationDeliveries
      ? { deliveries: dependencies.notificationDeliveries }
      : {}),
    ...(dependencies.notificationPreferences
      ? { preferences: dependencies.notificationPreferences }
      : {}),
  });
  app.openapi(statusRoute, (context) => {
    const details = {
      service: dependencies.service
        ? ("database" as const)
        : ("missing" as const),
      registration: dependencies.registrationBootstrap
        ? ("configured" as const)
        : ("missing" as const),
      partnerDomainOwnership: dependencies.partnerDomainOwnership
        ? ("configured" as const)
        : ("missing" as const),
      esign:
        dependencies.signingSessions && dependencies.esignWebhook
          ? ("configured" as const)
          : ("missing" as const),
      provisioningWebhook: dependencies.provisioningWebhook
        ? ("configured" as const)
        : ("missing" as const),
      marketplaceWebhook: dependencies.marketplaceWebhook
        ? ("configured" as const)
        : ("missing" as const),
      supportWebhook: dependencies.supportWebhook
        ? ("configured" as const)
        : ("missing" as const),
      evidenceStorage: dependencies.activeAgreementTemplates
        ? ("configured" as const)
        : ("missing" as const),
    };
    const status = !dependencies.service
      ? ("unavailable" as const)
      : Object.values(details).includes("missing")
        ? ("degraded" as const)
        : ("ready" as const);
    return context.json({ lane: "lifecycle" as const, status, details });
  });

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
    const verifier = dependencies.partnerDomainOwnership;
    if (!verifier)
      throw new ProblemError({
        type: "https://clockwork.test/problems/domain-ownership",
        title: "Domain ownership verification is unavailable",
        status: 503,
        code: "DOMAIN_OWNERSHIP_VERIFIER_UNAVAILABLE",
        requestId: request.requestId,
        retryable: true,
      });
    const body = context.req.valid("json");
    const verificationEvidence = await verifier.verify({
      domain: body.domain,
      verificationToken: body.verificationToken,
      requestId: request.requestId,
    });
    return context.json(
      await serviceOrThrow(dependencies, request).verifyPartnerDomain(
        { ...body, accountId: params.accountId, verificationEvidence },
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
    requirePermission(context, "agreement:approve", unscopedInternalOnly);
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

  app.openapi(activeAgreementTemplateRoute, async (context) => {
    const service = dependencies.activeAgreementTemplates;
    if (!service)
      return context.json(
        { title: "Agreement template evidence is not configured", status: 503 },
        503,
      );
    // The published template catalogue has no account column: the rows this
    // returns are approved, effective, jurisdiction-keyed legal text that every
    // tenant executes against, so there is no account to name. The decision
    // says that out loud rather than arriving here with a missing argument.
    const authorization = requirePermission(
      context,
      "agreement:read",
      unscopedBecause("global-agreement-template-catalog"),
    );
    const request = context.get("requestContext");
    const query = context.req.valid("query");
    return context.json(
      await service.getActive({
        ...query,
        authorization,
        requestId: request.requestId,
      }),
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
    assertSigningReturnUrl(body.returnUrl, request.requestId);
    if (process.env.NODE_ENV === "production" && !dependencies.signingSessions)
      return context.json(
        { title: "E-sign provider session is not configured", status: 503 },
        503,
      );
    const operation = operationContext(
      request,
      idempotencyKey(context.req.valid("header")),
    );
    const envelope = await serviceOrThrow(
      dependencies,
      request,
    ).createSignatureEnvelope(body, operation);
    return context.json(
      dependencies.signingSessions
        ? await dependencies.signingSessions.create({
            envelope,
            request: body,
            context: operation,
          })
        : envelope,
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
    const result = await verifyAndClaimWebhook({
      provider: "esign",
      eventType: (payload) =>
        z
          .object({ type: z.string().min(1) })
          .passthrough()
          .parse(payload).type,
      rawBody,
      signature: context.req.valid("header")["esign-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim.status === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim.status === "in_progress")
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
        result.claim.claimToken,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "esign",
        result.verified.eventId,
        result.claim.claimToken,
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
    const result = await verifyAndClaimWebhook({
      provider: "provisioning",
      eventType: (payload) =>
        z
          .object({ type: z.string().min(1) })
          .passthrough()
          .parse(payload).type,
      rawBody,
      signature: context.req.valid("header")["provisioning-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim.status === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim.status === "in_progress")
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
        result.claim.claimToken,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "provisioning",
        result.verified.eventId,
        result.claim.claimToken,
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
    const provider = context.req.valid("param").provider;
    const rawBody = request.rawWebhookBody;
    if (!rawBody) throw new Error("Verified webhook raw body was not captured");
    let marketplacePayload: MarketplaceEventPayload | undefined;
    const result = await verifyAndClaimWebhook({
      provider: `marketplace:${provider}`,
      eventType: () => {
        if (!marketplacePayload)
          throw new Error("Marketplace payload validation was not completed");
        return marketplacePayload.type;
      },
      validatePayload: (payload) => {
        const parsed = MarketplaceEventPayloadSchema.safeParse(payload);
        if (!parsed.success)
          throw new ProblemError({
            type: "https://clockwork.test/problems/marketplace-payload",
            title: "Marketplace webhook payload is invalid",
            status: 422,
            detail:
              "The verified marketplace payload did not match the canonical persistence contract.",
            code: "MARKETPLACE_PAYLOAD_INVALID",
            requestId: request.requestId,
            errors: {
              payload: parsed.error.issues.map((issue) => issue.message),
            },
            retryable: false,
          });
        if (parsed.data.provider !== provider)
          throw new ProblemError({
            type: "https://clockwork.test/problems/marketplace-provider",
            title: "Marketplace webhook provider does not match the path",
            status: 422,
            code: "MARKETPLACE_PROVIDER_MISMATCH",
            requestId: request.requestId,
            retryable: false,
          });
        marketplacePayload = parsed.data;
      },
      persistedPayload: () => marketplacePayload,
      rawBody,
      signature: context.req.valid("header")["marketplace-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim.status === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim.status === "in_progress")
      return context.json(
        { title: "Marketplace event already in progress", status: 503 },
        503,
      );
    if (!marketplacePayload)
      throw new Error("Marketplace payload validation was not completed");
    try {
      await dependencies.service.ingestMarketplaceEvent(marketplacePayload, {
        requestId: request.requestId,
        actor: { kind: "provider", id: `marketplace:${provider}` },
        idempotencyKey: `marketplace:${provider}:${result.verified.eventId}`,
        ip: request.ip,
        userAgent: request.userAgent,
        occurredAt: result.verified.occurredAt,
        authorization: null,
      });
      await adapter.deduplicator.markProcessed(
        `marketplace:${provider}`,
        result.verified.eventId,
        result.claim.claimToken,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        `marketplace:${provider}`,
        result.verified.eventId,
        result.claim.claimToken,
        error instanceof Error
          ? error.message
          : "Unknown marketplace webhook failure",
      );
      throw error;
    }
    return context.json({ status: "processed" as const }, 200);
  });

  app.openapi(supportWebhookRoute, async (context) => {
    const adapter = dependencies.supportWebhook;
    if (!adapter)
      return context.json(
        { title: "Support webhook is not configured", status: 503 },
        503,
      );
    const request = context.get("requestContext");
    const provider = context.req.valid("param").provider;
    const rawBody = request.rawWebhookBody;
    if (!rawBody) throw new Error("Verified webhook raw body was not captured");
    const result = await verifyAndClaimWebhook({
      provider: `support:${provider}`,
      eventType: (payload) =>
        z
          .object({ type: z.string().min(1) })
          .passthrough()
          .parse(payload).type,
      validatePayload: (payload) => {
        const verifiedProvider = z
          .object({ provider: z.string() })
          .passthrough()
          .parse(payload).provider;
        if (verifiedProvider !== provider)
          throw new ProblemError({
            type: "https://clockwork.test/problems/support-provider",
            title: "Support webhook provider does not match the path",
            status: 422,
            code: "SUPPORT_PROVIDER_MISMATCH",
            requestId: request.requestId,
            retryable: false,
          });
      },
      persistedPayload: (payload) => payload,
      rawBody,
      signature: context.req.valid("header")["support-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim.status === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim.status === "in_progress")
      return context.json(
        { title: "Support event already in progress", status: 503 },
        503,
      );
    try {
      await adapter.deduplicator.markProcessed(
        `support:${provider}`,
        result.verified.eventId,
        result.claim.claimToken,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        `support:${provider}`,
        result.verified.eventId,
        result.claim.claimToken,
        "SUPPORT_WEBHOOK_RECEIPT_FAILED",
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
    const request = context.get("requestContext");
    const pocId = context.req.valid("param").pocId;
    const scope = await authorizationScopesOrThrow(
      dependencies,
      request,
    ).resolvePocAccount({ pocId, requestId: request.requestId });
    requirePermission(
      context,
      "poc:manage",
      ids.account.parse(scope.accountId),
    );
    return context.json(
      await serviceOrThrow(dependencies, request).decidePoc(
        {
          ...context.req.valid("json"),
          pocId,
          accountId: scope.accountId,
        },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(provisioningRecoveryRoute, async (context) => {
    requirePermission(context, "system:operate", unscopedInternalOnly);
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
      query.accountId
        ? ids.account.parse(query.accountId)
        : unscopedBecause(
            "renewal-command-center-restricted-to-session-accounts",
          ),
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
    const request = context.get("requestContext");
    const orderId = context.req.valid("param").orderId;
    const scope = await authorizationScopesOrThrow(
      dependencies,
      request,
    ).resolveOrderScope({ orderId, requestId: request.requestId });
    requirePermission(
      context,
      "order:write",
      ids.account.parse(scope.authorizationAccountId),
    );
    return context.json(
      await serviceOrThrow(dependencies, request).requestRenewal(
        { ...body, orderId, accountId: scope.accountId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(renewalDeclineRoute, async (context) => {
    const body = context.req.valid("json");
    const request = context.get("requestContext");
    const orderId = context.req.valid("param").orderId;
    const scope = await authorizationScopesOrThrow(
      dependencies,
      request,
    ).resolveOrderScope({ orderId, requestId: request.requestId });
    requirePermission(
      context,
      "order:write",
      ids.account.parse(scope.authorizationAccountId),
    );
    return context.json(
      await serviceOrThrow(dependencies, request).declineRenewal(
        { ...body, orderId, accountId: scope.accountId },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(terminationRoute, async (context) => {
    const body = context.req.valid("json");
    const request = context.get("requestContext");
    const scope = await authorizationScopesOrThrow(
      dependencies,
      request,
    ).resolveOrderScope({
      orderId: body.orderId,
      requestId: request.requestId,
    });
    requirePermission(
      context,
      "destructive:request",
      ids.account.parse(scope.authorizationAccountId),
    );
    requireRecentAuthentication(context);
    return context.json(
      await serviceOrThrow(dependencies, request).requestTermination(
        {
          ...body,
          accountId: scope.accountId,
          partnerAccountId: scope.partnerAccountId,
        },
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(terminationApprovalRoute, async (context) => {
    requirePermission(context, "destructive:approve", unscopedInternalOnly);
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
    const request = context.get("requestContext");
    const caseId = context.req.valid("param").caseId;
    const scope = await authorizationScopesOrThrow(
      dependencies,
      request,
    ).resolveExceptionScope({ caseId, requestId: request.requestId });
    const authorization = requirePermission(
      context,
      queuePermission[scope.queue],
      scope.accountId
        ? ids.account.parse(scope.accountId)
        : unscopedInternalStaff,
    );
    if (!scope.accountId && !authorization.isInternalStaff)
      throw new ProblemError({
        type: "https://clockwork.test/problems/account-scope",
        title: "Account scope required",
        status: 403,
        code: "ACCOUNT_SCOPE_REQUIRED",
        requestId: request.requestId,
        retryable: false,
      });
    return context.json(
      await serviceOrThrow(dependencies, request).decideException(
        { ...body, caseId, accountId: scope.accountId, queue: scope.queue },
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
    const request = context.get("requestContext");
    const authorization = requirePermission(
      context,
      queuePermission[body.queue],
      body.accountId
        ? ids.account.parse(body.accountId)
        : unscopedInternalStaff,
    );
    if (!body.accountId && !authorization.isInternalStaff)
      throw new ProblemError({
        type: "https://clockwork.test/problems/account-scope",
        title: "Account scope required",
        status: 403,
        code: "ACCOUNT_SCOPE_REQUIRED",
        requestId: request.requestId,
        retryable: false,
      });
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
    const request = context.get("requestContext");
    const authorization = requirePermission(
      context,
      "migration:execute",
      unscopedInternalOnly,
    );
    requireRecentAuthentication(context);
    // `migration:execute` is granted to internal_operator alone, but the staff
    // assertion stays explicit: this route drives an authenticated request into
    // the legacy source system, and the finding here was that every layer
    // assumed a different layer had already checked.
    if (!authorization.isInternalStaff)
      throw new ProblemError({
        type: "https://clockwork.test/problems/authorization",
        title: "Internal staff required",
        status: 403,
        code: "INTERNAL_STAFF_REQUIRED",
        requestId: request.requestId,
        retryable: false,
      });
    return context.json(
      await serviceOrThrow(dependencies, request).startMigration(
        context.req.valid("json"),
        operationContext(request, idempotencyKey(context.req.valid("header"))),
      ),
      200,
    );
  });

  app.openapi(migrationMatchDecisionRoute, async (context) => {
    requirePermission(context, "destructive:approve", unscopedInternalOnly);
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
