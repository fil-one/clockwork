import { ids, ProblemError } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";

import { requirePermission } from "../../auth/authorize";
import type { ApiVariables, RequestContext } from "../../context";

/**
 * The alert kind, subject type and status vocabularies are the check
 * constraints in `001330_notification_deliveries.sql`. They are deliberately
 * not restated as enums here: a second copy would either reject a kind a later
 * migration adds -- turning a stored row into a 500 -- or drift into a list
 * that agrees with nothing. The database is the authority and this schema
 * carries the shape.
 */
const deliverySchema = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  channel: z.string().min(1).max(40),
  alertKind: z.string().min(1).max(60),
  subjectType: z.string().min(1).max(40),
  subjectId: z.uuid(),
  template: z.string().min(1).max(200),
  recipients: z.array(z.string()),
  status: z.string().min(1).max(20),
  providerMessageId: z.string().nullable(),
  failureCode: z.string().nullable(),
  requestedAt: z.iso.datetime({ offset: true }),
  deliveredAt: z.iso.datetime({ offset: true }).nullable(),
});

export interface NotificationDeliveryPage {
  items: readonly z.infer<typeof deliverySchema>[];
  nextCursor: string | null;
}

/** Read side of the delivery record; all SQL and RLS stay in `@clockwork/db`. */
export interface NotificationDeliveryService {
  list(input: {
    accountId: string;
    alertKind?: string;
    cursor?: string;
    limit: number;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<NotificationDeliveryPage>;
}

const preferenceSchema = z.object({
  accountId: z.uuid(),
  alertKind: z.string().min(1).max(60),
  channel: z.string().min(1).max(40),
  enabled: z.boolean(),
  rowVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type NotificationPreference = z.infer<typeof preferenceSchema>;

/**
 * Write side of `notification_preferences`. Which alert kinds are manageable is
 * the table's check constraint, so this port carries a plain string and the
 * database is what refuses a contractual notice or a dunning notice.
 */
export interface NotificationPreferenceService {
  list(input: {
    accountId: string;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<{ items: readonly NotificationPreference[] }>;
  set(input: {
    accountId: string;
    alertKind: string;
    channel: string;
    enabled: boolean;
    authorization: AuthorizationContext;
    requestId: string;
  }): Promise<NotificationPreference>;
}

export interface NotificationRouteDependencies {
  deliveries?: NotificationDeliveryService;
  preferences?: NotificationPreferenceService;
}

const listDeliveriesRoute = createRoute({
  method: "get",
  path: "/v1/notifications",
  tags: ["notifications"],
  request: {
    query: z.object({
      accountId: z.uuid(),
      alertKind: z.string().min(1).max(60).optional(),
      cursor: z.string().max(512).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: {
      description: "Stable cursor page of notification delivery evidence",
      content: {
        "application/json": {
          schema: z.object({
            items: z.array(deliverySchema),
            nextCursor: z.string().nullable(),
          }),
        },
      },
    },
    403: { description: "Account or role scope denied" },
    503: { description: "Notification delivery adapter is not configured" },
  },
});

const listPreferencesRoute = createRoute({
  method: "get",
  path: "/v1/notifications/preferences",
  tags: ["notifications"],
  request: { query: z.object({ accountId: z.uuid() }) },
  responses: {
    200: {
      description: "Notification preferences this account has set",
      content: {
        "application/json": {
          schema: z.object({ items: z.array(preferenceSchema) }),
        },
      },
    },
    403: { description: "Account or role scope denied" },
    503: { description: "Notification preference adapter is not configured" },
  },
});

const setPreferenceRoute = createRoute({
  method: "put",
  path: "/v1/notifications/preferences",
  tags: ["notifications"],
  request: {
    headers: z.object({ "idempotency-key": z.string().min(16).max(255) }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({
              accountId: z.uuid(),
              alertKind: z.string().min(1).max(60),
              channel: z.string().min(1).max(40).default("email"),
              enabled: z.boolean(),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Stored notification preference",
      content: { "application/json": { schema: preferenceSchema } },
    },
    403: { description: "Account or role scope denied" },
    422: {
      description:
        "The alert kind is a contractual or collections notice and cannot be switched off",
    },
    503: { description: "Notification preference adapter is not configured" },
  },
});

function deliveriesOrThrow(
  dependencies: NotificationRouteDependencies,
  request: RequestContext,
): NotificationDeliveryService {
  if (dependencies.deliveries) return dependencies.deliveries;
  throw new ProblemError({
    type: "https://clockwork.test/problems/notification-adapter",
    title: "Notification delivery adapter unavailable",
    status: 503,
    code: "NOTIFICATION_DELIVERY_ADAPTER_UNAVAILABLE",
    requestId: request.requestId,
    retryable: true,
  });
}

/**
 * §18 lists `/notifications` in the public API catalogue and the generated
 * contract carried no notification operation, so the delivery evidence
 * `001330_notification_deliveries.sql` records could not be read by the account
 * it was recorded against.
 *
 * The operation is account-scoped on purpose. There is no unscoped internal
 * listing here: a delivery row names the recipients of a commercial notice, and
 * the account that received it is the audience for that.
 */
function preferencesOrThrow(
  dependencies: NotificationRouteDependencies,
  request: RequestContext,
): NotificationPreferenceService {
  if (dependencies.preferences) return dependencies.preferences;
  throw new ProblemError({
    type: "https://clockwork.test/problems/notification-adapter",
    title: "Notification preference adapter unavailable",
    status: 503,
    code: "NOTIFICATION_PREFERENCE_ADAPTER_UNAVAILABLE",
    requestId: request.requestId,
    retryable: true,
  });
}

function preferenceProblem(request: RequestContext, error: unknown): never {
  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "ALERT_KIND_NOT_MANAGEABLE"
  )
    throw new ProblemError({
      type: "https://clockwork.test/problems/notification-preference",
      title: "Alert kind cannot be switched off",
      status: 422,
      detail: error.message,
      code: "NOTIFICATION_ALERT_KIND_NOT_MANAGEABLE",
      requestId: request.requestId,
      retryable: false,
    });
  throw error;
}

export function registerNotificationRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
  dependencies: NotificationRouteDependencies = {},
): void {
  app.openapi(listDeliveriesRoute, async (context) => {
    const query = context.req.valid("query");
    const authorization = requirePermission(
      context,
      "account:read",
      ids.account.parse(query.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await deliveriesOrThrow(dependencies, request).list({
        accountId: query.accountId,
        ...(query.alertKind ? { alertKind: query.alertKind } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
        limit: query.limit,
        authorization,
        requestId: request.requestId,
      }),
      200,
    );
  });

  app.openapi(listPreferencesRoute, async (context) => {
    const query = context.req.valid("query");
    const authorization = requirePermission(
      context,
      "account:read",
      ids.account.parse(query.accountId),
    );
    const request = context.get("requestContext");
    return context.json(
      await preferencesOrThrow(dependencies, request).list({
        accountId: query.accountId,
        authorization,
        requestId: request.requestId,
      }),
      200,
    );
  });

  app.openapi(setPreferenceRoute, async (context) => {
    const body = context.req.valid("json");
    const authorization = requirePermission(
      context,
      "account:write",
      ids.account.parse(body.accountId),
    );
    const request = context.get("requestContext");
    try {
      return context.json(
        await preferencesOrThrow(dependencies, request).set({
          accountId: body.accountId,
          alertKind: body.alertKind,
          channel: body.channel,
          enabled: body.enabled,
          authorization,
          requestId: request.requestId,
        }),
        200,
      );
    } catch (error) {
      return preferenceProblem(request, error);
    }
  });
}
