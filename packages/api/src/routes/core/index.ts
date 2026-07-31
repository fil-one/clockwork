import type { Permission, WebhookVerifier } from "@clockwork/contracts";
import { ProblemError } from "@clockwork/contracts";
import { authorizationActor } from "@clockwork/domain";
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
            status: z.literal("ready"),
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

const ReportNameSchema = z.enum([
  "revenue_forecast",
  "capacity_planning",
  "renewal_churn_exposure",
  "partner_performance",
  "funnel_cycle_time",
  "margin_poc_cost",
  "three_way_tie_out",
  "weekly_scorecard",
]);

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
  disputes: "billing:write",
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

export interface CoreRouteDependencies {
  service: CoreFinanceService;
  stripeWebhook?: {
    verifier: WebhookVerifier<unknown>;
    deduplicator: WebhookDeduplicator;
    apply(event: unknown, eventId: string, occurredAt: string): Promise<void>;
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

function dependencies(): CoreRouteDependencies {
  if (configuredDependencies) return configuredDependencies;
  if (process.env.NODE_ENV === "production")
    throw new Error("Core-finance route dependencies are not configured");
  return { service: developmentService };
}

function csvCell(value: unknown): string {
  const raw =
    value === undefined || value === null
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" ||
            typeof value === "boolean" ||
            typeof value === "bigint"
          ? `${value}`
          : (JSON.stringify(value) ?? "");
  const safe = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

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
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => csvCell(row[column as keyof typeof row]))
        .join(","),
    ),
  ].join("\r\n");
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
): void {
  app.openapi(statusRoute, (context) =>
    context.json({ lane: "core", status: "ready" }),
  );

  app.openapi(commandRoute, async (context) => {
    const resource = context.req.valid("param").resource;
    const body = context.req.valid("json");
    const accountId = body.accountId as Parameters<typeof requirePermission>[2];
    const current = context.get("requestContext").authorization;
    const partnerActor = current?.roles.some(
      (role) => role === "partner_admin" || role === "partner_seller",
    );
    const permission =
      (resource === "quotes" || resource === "deal_registrations") &&
      partnerActor
        ? "partner:quote:write"
        : resource === "deal_registrations"
          ? "quote:write"
          : permissionByResource[resource];
    const authorization = requirePermission(context, permission, accountId);
    try {
      return context.json(
        await dependencies().service.mutate({
          resource,
          id: body.id,
          ...(body.accountId ? { accountId: body.accountId } : {}),
          action: body.action,
          ...(body.expectedVersion
            ? { expectedVersion: body.expectedVersion }
            : {}),
          payload: body.payload,
          actor: authorizationActor(authorization),
          requestId: context.get("requestContext").requestId,
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
      query.accountId as Parameters<typeof requirePermission>[2],
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
        await dependencies().service.list({
          resource,
          ...(query.accountId ? { accountId: query.accountId } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          limit: query.limit,
        }),
        200,
      );
    } catch (error) {
      return serviceProblem(context, error);
    }
  });

  app.openapi(replayRoute, async (context) => {
    const authorization = requirePermission(context, "system:operate");
    requireRecentAuthentication(context);
    const params = context.req.valid("param");
    return context.json(
      await dependencies().service.replay({
        provider: params.provider,
        eventId: params.eventId,
        actor: authorizationActor(authorization),
        requestId: context.get("requestContext").requestId,
      }),
      200,
    );
  });

  app.openapi(reportRoute, async (context) => {
    const query = context.req.valid("query");
    const authorization = requirePermission(
      context,
      "report:read",
      query.accountId as Parameters<typeof requirePermission>[2],
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
    const page = await dependencies().service.list({
      resource: "reports",
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      limit: query.limit,
    });
    const report = context.req.valid("param").report;
    const filtered = {
      ...page,
      items: page.items.filter((record) => record.data.report === report),
    };
    if (query.format === "csv")
      return context.body(reportCsv(filtered.items), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${report}.csv"`,
      });
    return context.json(filtered, 200);
  });

  app.openapi(stripeWebhookRoute, async (context) => {
    const adapter = dependencies().stripeWebhook;
    if (!adapter)
      return context.json(
        { title: "Stripe webhook is not configured", status: 503 },
        503,
      );
    const rawBody = context.get("requestContext").rawWebhookBody;
    if (!rawBody) throw new Error("Stripe raw webhook body was not captured");
    const unverified = z
      .object({ type: z.string().min(1) })
      .passthrough()
      .parse(JSON.parse(new TextDecoder().decode(rawBody)));
    const result = await verifyAndClaimWebhook({
      provider: "stripe",
      eventType: unverified.type,
      rawBody,
      signature: context.req.valid("header")["stripe-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
    });
    if (result.claim === "duplicate")
      return context.json({ status: "duplicate" as const }, 200);
    if (result.claim === "in_progress")
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
      );
      return context.json({ status: "processed" as const }, 200);
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "stripe",
        result.verified.eventId,
        error instanceof Error
          ? error.message
          : "Unknown Stripe projection failure",
      );
      throw error;
    }
  });
}
