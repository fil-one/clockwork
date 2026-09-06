import type { Permission, WebhookVerifier } from "@clockwork/contracts";
import { ids, ProblemError } from "@clockwork/contracts";
import {
  authorizationActor,
  unscopedBecause,
  unscopedInternalOnly,
  unscopedInternalStaff,
} from "@clockwork/domain";
import { csvColumns, toCsv } from "@clockwork/domain/core";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  requirePermission,
  requireRecentAuthentication,
} from "../../auth/authorize";
import type { ApiVariables } from "../../context";
import { verifyAndClaimWebhook } from "../../webhooks";
import type { WebhookDeduplicator } from "../../webhooks";
import {
  CoreServiceError,
  coreReportNames,
  coreResourceNames,
  MemoryCoreFinanceService,
} from "./service";
import type { CoreFinanceService, CoreResourceName } from "./service";

export * from "./service";

const ResourceSchema = z.enum(coreResourceNames);
const UuidSchema = z.uuid();
const JsonObjectSchema = z.record(z.string(), z.unknown());
const RecordSchema = z.object({
  id: z.string(),
  resource: ResourceSchema,
  accountId: z.string().optional(),
  rowVersion: z.number().int().positive(),
  data: JsonObjectSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const statusRoute = createRoute({
  method: "get",
  path: "/v1/core/status",
  tags: ["core"],
  responses: {
    200: {
      description: "Core-finance lane status",
      content: {
        "application/json": {
          schema: z.object({
            lane: z.literal("core"),
            status: z.enum(["ready", "degraded", "unavailable"]),
            details: z.object({
              service: z.enum(["database", "memory", "missing"]),
              stripeWebhook: z.enum(["configured", "missing"]),
              stripePayment: z.enum(["configured", "missing"]),
              artifactStorage: z.enum(["configured", "missing"]),
            }),
          }),
        },
      },
    },
  },
});

const commandRoute = createRoute({
  method: "post",
  path: "/v1/core/commands/{resource}",
  tags: ["core"],
  request: {
    params: z.object({ resource: ResourceSchema }),
    headers: z.object({ "idempotency-key": z.string().min(16).max(255) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            id: UuidSchema,
            accountId: UuidSchema.optional(),
            action: z.string().min(1).max(80),
            expectedVersion: z.number().int().positive().optional(),
            payload: JsonObjectSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Versioned core-finance mutation with atomic audit/outbox identifiers",
      content: {
        "application/json": {
          schema: z.object({
            record: RecordSchema,
            auditEventId: z.string(),
            outboxMessageId: z.string(),
          }),
        },
      },
    },
    403: { description: "Account or role scope denied" },
    404: { description: "Resource not found" },
    409: { description: "Optimistic version or duplicate conflict" },
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/v1/core/records/{resource}",
  tags: ["core"],
  request: {
    params: z.object({ resource: ResourceSchema }),
    query: z.object({
      accountId: UuidSchema.optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: {
      description: "Stable cursor page",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(RecordSchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    403: { description: "Account or role scope denied" },
  },
});

const replayRoute = createRoute({
  method: "post",
  path: "/v1/core/replays/{provider}/{eventId}",
  tags: ["core", "operations"],
  request: {
    params: z.object({
      provider: z.string().min(1),
      eventId: z.string().min(1),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ reason: z.string().trim().min(8).max(2_000) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Replay claimed idempotently",
      content: {
        "application/json": {
          schema: z.object({
            replayed: z.boolean(),
            workflowRunId: z.string(),
          }),
        },
      },
    },
    403: {
      description: "Operator or recent-authentication requirement failed",
    },
  },
});

const ReportNameSchema = z.enum(coreReportNames);

const reportRoute = createRoute({
  method: "get",
  path: "/v1/core/reports/{report}",
  tags: ["core", "reports"],
  request: {
    params: z.object({ report: ReportNameSchema }),
    query: z.object({
      accountId: UuidSchema.optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      format: z.enum(["json", "csv"]).default("json"),
    }),
  },
  responses: {
    200: {
      description: "Current management report, traceable to source records",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(RecordSchema),
            nextCursor: z.string().nullable(),
          }),
        },
        "text/csv": { schema: z.string() },
      },
    },
    403: { description: "Report scope denied" },
  },
});

const stripeWebhookRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/stripe",
  tags: ["core", "webhooks"],
  request: {
    headers: z.object({ "stripe-signature": z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.unknown() } },
    },
  },
  responses: {
    200: {
      description: "Verified event applied or deduplicated",
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["processed", "duplicate"]) }),
        },
      },
    },
    503: {
      description: "Webhook processing is unavailable or already in progress",
    },
  },
});

const paymentSessionRoute = createRoute({
  method: "post",
  path: "/v1/core/payment-sessions",
  tags: ["core", "billing"],
  request: {
    headers: z.object({ "idempotency-key": z.string().min(16).max(255) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ accountId: UuidSchema, invoiceId: UuidSchema })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description:
        "Stripe-hosted customer payment session; payment truth remains webhook-derived",
      content: {
        "application/json": {
          schema: z.object({
            provider: z.literal("stripe"),
            sessionId: z.string().min(1),
            invoiceId: UuidSchema,
            url: z.url(),
            status: z.literal("requires_customer_action"),
          }),
        },
      },
    },
    403: { description: "Billing permission or account scope denied" },
    409: { description: "Invoice is no longer payable" },
    503: { description: "Stripe payment session is not configured" },
  },
});

const ArtifactKindSchema = z.enum([
  "agreement_template",
  "quote",
  "partner_quote",
  "order_form",
]);
const artifactRoute = createRoute({
  method: "get",
  path: "/v1/core/artifacts/{kind}/{id}",
  tags: ["core", "documents"],
  request: {
    params: z.object({ kind: ArtifactKindSchema, id: UuidSchema }),
    query: z.object({ accountId: UuidSchema.optional() }),
  },
  responses: {
    200: {
      description: "Authorized immutable artifact bytes",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ format: "binary" }),
        },
      },
    },
    403: { description: "Artifact account scope denied" },
    404: { description: "Artifact not found" },
    503: { description: "Immutable evidence storage is not configured" },
  },
});

const permissionByResource: Record<CoreResourceName, Permission> = {
  accounts: "account:write",
  procurement_profiles: "account:write",
  price_books: "quote:approve",
  quotes: "quote:write",
  orders: "order:write",
  amendments: "order:write",
  commitments: "billing:write",
  invoices: "billing:write",
  credit_notes: "billing:approve",
  refunds: "billing:approve",
  disputes: "billing:approve",
  deal_registrations: "partner:quote:write",
  commissions: "billing:approve",
  accounting_exports: "billing:approve",
  marketplace_reconciliations: "billing:approve",
  reports: "report:read",
};

const readPermissionByResource: Record<CoreResourceName, Permission> = {
  accounts: "account:read",
  procurement_profiles: "account:read",
  price_books: "quote:read",
  quotes: "quote:read",
  orders: "order:read",
  amendments: "order:read",
  commitments: "billing:read",
  invoices: "billing:read",
  credit_notes: "billing:read",
  refunds: "billing:read",
  disputes: "billing:read",
  deal_registrations: "partner:portfolio:read",
  commissions: "billing:read",
  accounting_exports: "report:read",
  marketplace_reconciliations: "report:read",
  reports: "report:read",
};

const actionPermissionByResource: Partial<
  Record<CoreResourceName, Readonly<Record<string, Permission>>>
> = {
  quotes: {
    approve_exception: "quote:approve",
    reject_exception: "quote:approve",
  },
  invoices: {
    void: "billing:approve",
    mark_uncollectible: "billing:approve",
    evaluate_dunning: "billing:approve",
  },
  deal_registrations: {
    approve: "quote:approve",
    reject: "quote:approve",
    decide_dispute: "quote:approve",
  },
};

const recentAuthenticationActions = new Set([
  "price_books:create",
  "price_books:add_rate",
  "price_books:update_rate",
  "price_books:remove_rate",
  "price_books:update_discount_matrix",
  "price_books:reject_activation",
  "price_books:request_activation",
  "price_books:activate",
  "price_books:retire",
  "quotes:approve_exception",
  "quotes:reject_exception",
  "invoices:void",
  "invoices:mark_uncollectible",
  "credit_notes:approve",
  "credit_notes:issue",
  "refunds:create",
  "refunds:submit",
  "disputes:create",
  "deal_registrations:decide_dispute",
  "commissions:clawback",
  "commissions:settle",
  "accounting_exports:post",
  "accounting_exports:reconcile",
  "marketplace_reconciliations:reconcile",
  "marketplace_reconciliations:replay",
]);

export interface CoreRouteDependencies {
  service: CoreFinanceService;
  mode?: "database" | "memory";
  stripeWebhook?: {
    verifier: WebhookVerifier<unknown>;
    deduplicator: WebhookDeduplicator;
    apply(event: unknown, eventId: string, occurredAt: string): Promise<void>;
  };
  paymentSessions?: {
    create(input: {
      accountId: string;
      invoiceId: string;
      idempotencyKey: string;
      authorization: ReturnType<typeof requirePermission>;
      requestId: string;
    }): Promise<{
      provider: "stripe";
      sessionId: string;
      invoiceId: string;
      url: string;
      status: "requires_customer_action";
    }>;
  };
  artifacts?: {
    read(input: {
      artifactKind: z.infer<typeof ArtifactKindSchema>;
      artifactId: string;
      accountId?: string;
      authorization: ReturnType<typeof requirePermission>;
      requestId: string;
    }): Promise<{
      bytes: Uint8Array;
      contentHash: string;
      mimeType: string;
      byteLength: string;
      filename: string;
    }>;
  };
}

let configuredDependencies: CoreRouteDependencies | undefined;
const developmentService = new MemoryCoreFinanceService();

/** Integration composition calls this once during process initialization. */
export function configureCoreRouteDependencies(
  dependencies: CoreRouteDependencies,
): void {
  configuredDependencies = dependencies;
}

export function resetCoreRouteDependenciesForTest(): void {
  configuredDependencies = undefined;
}

function dependencies(
  routeDependencies?: CoreRouteDependencies,
): CoreRouteDependencies {
  if (routeDependencies) return routeDependencies;
  if (configuredDependencies) return configuredDependencies;
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.CLOCKWORK_ENABLE_SIMULATORS === "true"
  )
    return { service: developmentService };
  throw new Error("Core-finance route dependencies are not configured");
}

/**
 * The download a caller actually receives. It renders through the same writer
 * as the workflow report export, so neither escapes a formula the other lets
 * through. Column order stays as discovered rather than sorted because the
 * record identity columns lead the download.
 */
function reportCsv(
  records: readonly {
    id: string;
    rowVersion: number;
    data: Record<string, unknown>;
  }[],
): string {
  const rows = records.map((record) => ({
    id: record.id,
    rowVersion: record.rowVersion,
    ...record.data,
  }));
  if (rows.length === 0) return "";
  return toCsv(rows, csvColumns(rows));
}

function serviceProblem(
  context: { get(name: "requestContext"): ApiVariables["requestContext"] },
  error: unknown,
): never {
  const requestId = context.get("requestContext").requestId;
  if (error instanceof CoreServiceError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "INVALID_STATE"
          ? 422
          : 409;
    throw new ProblemError({
      type: `https://clockwork.test/problems/${error.code.toLocaleLowerCase().replace(/_/g, "-")}`,
      title:
        error.code === "VERSION_CONFLICT"
          ? "Optimistic concurrency conflict"
          : "Core-finance operation rejected",
      status,
      detail: error.message,
      code: error.code,
      requestId,
      retryable: false,
    });
  }
  throw error;
}

export function registerCoreRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
  routeDependencies?: CoreRouteDependencies,
): void {
  app.openapi(statusRoute, (context) => {
    const configured = routeDependencies ?? configuredDependencies;
    const service = configured
      ? (configured.mode ?? "memory")
      : process.env.NODE_ENV !== "production" &&
          process.env.CLOCKWORK_ENABLE_SIMULATORS === "true"
        ? "memory"
        : "missing";
    const stripeWebhook = configured?.stripeWebhook ? "configured" : "missing";
    const stripePayment = configured?.paymentSessions
      ? "configured"
      : "missing";
    const artifactStorage = configured?.artifacts ? "configured" : "missing";
    const status =
      service === "missing"
        ? "unavailable"
        : service === "database" && stripeWebhook === "configured"
          ? "ready"
          : "degraded";
    return context.json({
      lane: "core" as const,
      status,
      details: { service, stripeWebhook, stripePayment, artifactStorage },
    });
  });

  app.openapi(commandRoute, async (context) => {
    const resource = context.req.valid("param").resource;
    const body = context.req.valid("json");
    const current = context.get("requestContext").authorization;
    if (!body.accountId && !current?.isInternalStaff)
      throw new ProblemError({
        type: "https://clockwork.test/problems/account-scope",
        title: "Account scope required",
        status: 403,
        code: "ACCOUNT_SCOPE_REQUIRED",
        requestId: context.get("requestContext").requestId,
        retryable: false,
      });
    const accountId = body.accountId
      ? ids.account.parse(body.accountId)
      : undefined;
    const partnerActor = current?.roles.some(
      (role) => role === "partner_admin" || role === "partner_seller",
    );
    const actionPermission =
      actionPermissionByResource[resource]?.[body.action];
    const permission = actionPermission
      ? actionPermission
      : (resource === "quotes" || resource === "deal_registrations") &&
          partnerActor
        ? "partner:quote:write"
        : resource === "deal_registrations"
          ? "quote:write"
          : permissionByResource[resource];
    // Partner identity is an asserted quote input, but order acceptance derives
    // it from the persisted issued quote. Requiring it again on an order would
    // reintroduce caller-supplied counterparty truth at the API boundary.
    const partnerAuthorizationAccount =
      partnerActor && resource === "quotes"
        ? z.uuid().safeParse(body.payload.partnerAccountId)
        : undefined;
    if (
      partnerActor &&
      resource === "quotes" &&
      !partnerAuthorizationAccount?.success
    )
      throw new ProblemError({
        type: "https://clockwork.test/problems/partner-scope",
        title: "Partner account scope required",
        status: 403,
        code: "PARTNER_SCOPE_REQUIRED",
        requestId: context.get("requestContext").requestId,
        retryable: false,
      });
    const authorization = requirePermission(
      context,
      permission,
      partnerAuthorizationAccount?.success
        ? ids.account.parse(partnerAuthorizationAccount.data)
        : partnerActor && resource === "orders"
          ? unscopedBecause(
              "partner-order-acceptance-derives-account-from-issued-quote",
            )
          : // `accountId` is only absent for internal staff -- the guard above
            // already refused a tenant with no account on the body -- and the
            // control re-checks that rather than trusting the guard.
            (accountId ?? unscopedInternalStaff),
    );
    if (recentAuthenticationActions.has(`${resource}:${body.action}`))
      requireRecentAuthentication(context);
    try {
      return context.json(
        await dependencies(routeDependencies).service.mutate({
          resource,
          id: body.id,
          ...(body.accountId ? { accountId: body.accountId } : {}),
          action: body.action,
          ...(body.expectedVersion
            ? { expectedVersion: body.expectedVersion }
            : {}),
          payload: body.payload,
          actor: authorizationActor(authorization),
          authorization,
          requestId: context.get("requestContext").requestId,
          idempotencyKey: context.req.valid("header")["idempotency-key"],
          occurredAt: context.get("requestContext").receivedAt.toISOString(),
        }),
        200,
      );
    } catch (error) {
      return serviceProblem(context, error);
    }
  });

  app.openapi(listRoute, async (context) => {
    const resource = context.req.valid("param").resource;
    const query = context.req.valid("query");
    const authorization = requirePermission(
      context,
      readPermissionByResource[resource],
      query.accountId
        ? ids.account.parse(query.accountId)
        : unscopedInternalStaff,
    );
    if (!authorization.isInternalStaff && !query.accountId)
      throw new ProblemError({
        type: "https://clockwork.test/problems/account-scope",
        title: "Account scope required",
        status: 403,
        code: "ACCOUNT_SCOPE_REQUIRED",
        requestId: context.get("requestContext").requestId,
        retryable: false,
      });
    try {
      return context.json(
        await dependencies(routeDependencies).service.list({
          resource,
          ...(query.accountId ? { accountId: query.accountId } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          limit: query.limit,
          authorization,
        }),
        200,
      );
    } catch (error) {
      return serviceProblem(context, error);
    }
  });

  app.openapi(replayRoute, async (context) => {
    const authorization = requirePermission(
      context,
      "system:operate",
      unscopedInternalOnly,
    );
    requireRecentAuthentication(context);
    const params = context.req.valid("param");
    const body = context.req.valid("json");
    try {
      return context.json(
        await dependencies(routeDependencies).service.replay({
          provider: params.provider,
          eventId: params.eventId,
          actor: authorizationActor(authorization),
          reason: body.reason,
          requestId: context.get("requestContext").requestId,
        }),
        200,
      );
    } catch (error) {
      return serviceProblem(context, error);
    }
  });

  app.openapi(reportRoute, async (context) => {
    const query = context.req.valid("query");
    const authorization = requirePermission(
      context,
      "report:read",
      query.accountId
        ? ids.account.parse(query.accountId)
        : unscopedInternalStaff,
    );
    if (!authorization.isInternalStaff && !query.accountId)
      throw new ProblemError({
        type: "https://clockwork.test/problems/account-scope",
        title: "Account scope required",
        status: 403,
        code: "ACCOUNT_SCOPE_REQUIRED",
        requestId: context.get("requestContext").requestId,
        retryable: false,
      });
    const report = context.req.valid("param").report;
    try {
      const page = await dependencies(routeDependencies).service.report({
        report,
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit,
        authorization,
      });
      if (query.format === "csv")
        return context.body(reportCsv(page.items), 200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${report}.csv"`,
        });
      return context.json(page, 200);
    } catch (error) {
      return serviceProblem(context, error);
    }
  });

  app.openapi(stripeWebhookRoute, async (context) => {
    const adapter = dependencies(routeDependencies).stripeWebhook;
    if (!adapter)
      return context.json(
        { title: "Stripe webhook is not configured", status: 503 },
        503,
      );
    const rawBody = context.get("requestContext").rawWebhookBody;
    if (!rawBody) throw new Error("Stripe raw webhook body was not captured");
    const result = await verifyAndClaimWebhook({
      provider: "stripe",
      eventType: (payload) =>
        z
          .object({ type: z.string().min(1) })
          .passthrough()
          .parse(payload).type,
      rawBody,
      signature: context.req.valid("header")["stripe-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
      persistedPayload: (payload) => {
        const normalized = z
          .object({
            type: z.string().min(1),
            event: z.record(z.string(), z.unknown()),
          })
          .safeParse(payload);
        if (!normalized.success) return payload;
        return {
          type: normalized.data.type,
          event: Object.fromEntries(
            Object.entries(normalized.data.event).filter(
              ([key]) => key !== "rawObject",
            ),
          ),
        };
      },
    });
    if (result.claim.status === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim.status === "in_progress")
      return context.json(
        {
          title: "Webhook delivery is already being processed",
          status: 503,
          retryable: true,
        },
        503,
      );
    try {
      await adapter.apply(
        result.verified.payload,
        result.verified.eventId,
        result.verified.occurredAt,
      );
      await adapter.deduplicator.markProcessed(
        "stripe",
        result.verified.eventId,
        result.claim.claimToken,
      );
      return context.json({ status: "processed" as const }, 200);
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "stripe",
        result.verified.eventId,
        result.claim.claimToken,
        error instanceof Error
          ? error.message
          : "Unknown Stripe projection failure",
      );
      throw error;
    }
  });

  app.openapi(paymentSessionRoute, async (context) => {
    const adapter = dependencies(routeDependencies).paymentSessions;
    if (!adapter)
      return context.json(
        { title: "Stripe payment session is not configured", status: 503 },
        503,
      );
    const body = context.req.valid("json");
    const authorization = requirePermission(
      context,
      "billing:write",
      ids.account.parse(body.accountId),
    );
    requireRecentAuthentication(context);
    try {
      return context.json(
        await adapter.create({
          accountId: body.accountId,
          invoiceId: body.invoiceId,
          idempotencyKey: context.req.valid("header")["idempotency-key"],
          authorization,
          requestId: context.get("requestContext").requestId,
        }),
        200,
      );
    } catch (error) {
      return serviceProblem(context, error);
    }
  });

  app.openapi(artifactRoute, async (context) => {
    const adapter = dependencies(routeDependencies).artifacts;
    if (!adapter)
      return context.json(
        { title: "Immutable artifact storage is not configured", status: 503 },
        503,
      );
    const params = context.req.valid("param");
    const query = context.req.valid("query");
    if (params.kind !== "agreement_template" && !query.accountId)
      throw new ProblemError({
        type: "https://clockwork.test/problems/account-scope",
        title: "Artifact account scope is required",
        status: 403,
        code: "ACCOUNT_SCOPE_REQUIRED",
        requestId: context.get("requestContext").requestId,
        retryable: false,
      });
    const permission: Permission =
      params.kind === "agreement_template"
        ? "agreement:read"
        : params.kind === "order_form"
          ? "order:read"
          : "quote:read";
    const authorization = requirePermission(
      context,
      permission,
      // Only `agreement_template` reaches here without an account filter --
      // the guard above refuses every other kind -- and that artifact is the
      // published catalogue document, which carries no account.
      query.accountId
        ? ids.account.parse(query.accountId)
        : unscopedBecause("global-agreement-template-catalog"),
    );
    const artifact = await adapter.read({
      artifactKind: params.kind,
      artifactId: params.id,
      ...(query.accountId ? { accountId: query.accountId } : {}),
      authorization,
      requestId: context.get("requestContext").requestId,
    });
    const body = new ArrayBuffer(artifact.bytes.byteLength);
    new Uint8Array(body).set(artifact.bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": artifact.mimeType,
        "content-length": artifact.byteLength,
        "content-disposition": `attachment; filename="${artifact.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        "x-content-sha256": artifact.contentHash,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
      },
    });
  });
}
