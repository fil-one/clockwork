import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { WebhookVerifier } from "@clockwork/contracts";
import type { ActivationTestRunner } from "@clockwork/domain/system";
import type { RoleSynchronizationSink } from "@clockwork/integrations";
import { synchronizeWorkosRoleEvent } from "@clockwork/integrations";

import type { ApiVariables } from "../../context";
import { verifyAndClaimWebhook } from "../../webhooks";
import type { WebhookDeduplicator } from "../../webhooks";
import {
  registerExternalGateRoutes,
  type ExternalGateService,
} from "./external-gates";

export * from "./external-gate-simulator";

export * from "./external-gates";

const route = createRoute({
  method: "get",
  path: "/v1/system/status",
  tags: ["system"],
  responses: {
    200: {
      description: "Experience/system lane mount",
      content: {
        "application/json": {
          schema: z.object({
            lane: z.literal("system"),
            status: z.enum(["ready", "degraded", "unavailable"]),
            details: z.object({
              externalGates: z.enum(["configured", "missing"]),
              activationTestRunner: z.enum(["configured", "missing"]),
              workosWebhook: z.enum(["configured", "missing"]),
            }),
          }),
        },
      },
    },
  },
});

const workosWebhookRoute = createRoute({
  method: "post",
  path: "/v1/webhooks/workos",
  tags: ["system", "webhooks"],
  request: {
    headers: z.object({ "workos-signature": z.string().min(1) }),
    body: {
      required: true,
      content: { "application/json": { schema: z.unknown() } },
    },
  },
  responses: {
    200: {
      description: "Verified WorkOS event accepted or deduplicated",
      content: {
        "application/json": {
          schema: z.object({ status: z.enum(["processed", "duplicate"]) }),
        },
      },
    },
    503: { description: "Webhook adapter is not configured" },
  },
});

export interface SystemRouteDependencies {
  externalGates?: ExternalGateService;
  externalGateActivationTests?: ActivationTestRunner;
  workosWebhook?: {
    verifier: WebhookVerifier<unknown>;
    deduplicator: WebhookDeduplicator;
    roleSink: RoleSynchronizationSink;
  };
}

export function registerSystemRoutes(
  app: OpenAPIHono<{ Variables: ApiVariables }>,
  dependencies: SystemRouteDependencies = {},
): void {
  app.openapi(route, (context) => {
    const details = {
      externalGates: dependencies.externalGates
        ? ("configured" as const)
        : ("missing" as const),
      activationTestRunner: dependencies.externalGateActivationTests
        ? ("configured" as const)
        : ("missing" as const),
      workosWebhook: dependencies.workosWebhook
        ? ("configured" as const)
        : ("missing" as const),
    };
    const configured = Object.values(details).filter(
      (value) => value === "configured",
    ).length;
    const status =
      configured === 0
        ? ("unavailable" as const)
        : configured === Object.keys(details).length
          ? ("ready" as const)
          : ("degraded" as const);
    return context.json({ lane: "system" as const, status, details });
  });
  registerExternalGateRoutes(
    app,
    dependencies.externalGates,
    dependencies.externalGateActivationTests,
  );
  app.openapi(workosWebhookRoute, async (context) => {
    const adapter = dependencies.workosWebhook;
    if (!adapter)
      return context.json(
        { title: "WorkOS webhook is not configured", status: 503 },
        503,
      );
    const rawBody = context.get("requestContext").rawWebhookBody;
    if (!rawBody) throw new Error("Verified webhook raw body was not captured");
    const result = await verifyAndClaimWebhook({
      provider: "workos",
      eventType: (payload) =>
        z
          .object({ event: z.string().min(1) })
          .passthrough()
          .parse(payload).event,
      rawBody,
      signature: context.req.valid("header")["workos-signature"],
      verifier: adapter.verifier,
      deduplicator: adapter.deduplicator,
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
      await synchronizeWorkosRoleEvent(
        result.verified.payload,
        adapter.roleSink,
      );
      await adapter.deduplicator.markProcessed(
        "workos",
        result.verified.eventId,
        result.claim.claimToken,
      );
    } catch (error) {
      await adapter.deduplicator.markFailed(
        "workos",
        result.verified.eventId,
        result.claim.claimToken,
        error instanceof Error ? error.message : "Unknown role-sync failure",
      );
      throw error;
    }
    return context.json({ status: "processed" as const }, 200);
  });
}
