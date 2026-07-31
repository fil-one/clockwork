import { delay, http, HttpResponse, type RequestHandler } from "msw";

import { DEMO_ORIGIN } from "./seed";

export const STATUS_ENDPOINTS = {
  core: "/v1/core/status",
  lifecycle: "/v1/lifecycle/status",
  system: "/v1/system/status",
} as const;

export type DemoStatusMode = "offline" | "ready";

export interface DemoStatusHandlerOptions {
  readonly baseUrl?: string;
  readonly latencyMs?: number;
  readonly mode?: DemoStatusMode;
}

/** Status-only handlers for narrow health checks. */
export function createDemoStatusHandlers(
  options: DemoStatusHandlerOptions = {},
): readonly RequestHandler[] {
  const baseUrl = (options.baseUrl ?? DEMO_ORIGIN).replace(/\/$/, "");
  const latencyMs = options.latencyMs ?? 0;
  const mode = options.mode ?? "ready";

  const respond = async <Lane extends "core" | "lifecycle" | "system">(
    lane: Lane,
  ) => {
    if (latencyMs > 0) await delay(latencyMs);
    if (mode === "offline") return HttpResponse.error();

    return HttpResponse.json({ lane, status: "ready" as const });
  };

  return [
    http.get(`${baseUrl}${STATUS_ENDPOINTS.core}`, () => respond("core")),
    http.get(`${baseUrl}${STATUS_ENDPOINTS.lifecycle}`, () =>
      respond("lifecycle"),
    ),
    http.get(`${baseUrl}${STATUS_ENDPOINTS.system}`, () => respond("system")),
  ];
}

export const COMMERCE_ENDPOINTS = {
  command: "/v1/core/commands/{resource}",
  clickAgreement: "/v1/lifecycle/agreements/click-through",
  envelope: "/v1/lifecycle/agreements/envelopes",
  partnerDomain: "/v1/lifecycle/partners/{accountId}/domains",
  exceptionDecision: "/v1/lifecycle/exceptions/{caseId}/decisions",
  pocs: "/v1/lifecycle/pocs",
  pocConversion: "/v1/lifecycle/pocs/{pocId}/conversion",
  renewalRequest: "/v1/lifecycle/renewals/{orderId}/requests",
  renewalDecline: "/v1/lifecycle/renewals/{orderId}/declines",
  termination: "/v1/lifecycle/terminations",
  report: "/v1/core/reports/{report}",
} as const;

function hasMutationProof(request: Request): boolean {
  return Boolean(
    request.headers.get("idempotency-key") &&
    request.headers.get("x-csrf-token"),
  );
}

/**
 * Contract-faithful simulators for generated operations used by the experience
 * lane. Mutations require both replay protection and CSRF evidence, while the
 * response bodies stay within generated/openapi.json.
 */
export function createDemoCommerceHandlers(
  options: DemoStatusHandlerOptions = {},
): readonly RequestHandler[] {
  const baseUrl = (options.baseUrl ?? DEMO_ORIGIN).replace(/\/$/, "");
  const latencyMs = options.latencyMs ?? 0;
  const mode = options.mode ?? "ready";

  const beforeResponse = async (request?: Request) => {
    if (latencyMs > 0) await delay(latencyMs);
    if (mode === "offline") return HttpResponse.error();
    if (request && !hasMutationProof(request))
      return HttpResponse.json({ error: "forbidden" }, { status: 403 });
    return undefined;
  };

  const lifecycleMutation = async ({ request }: { request: Request }) => {
    const early = await beforeResponse(request);
    if (early) return early;
    return HttpResponse.json({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "accepted",
      eventType: "commerce.requested",
    });
  };

  return [
    ...createDemoStatusHandlers(options),
    http.post(
      `${baseUrl}/v1/core/commands/:resource`,
      async ({ request, params }) => {
        const early = await beforeResponse(request);
        if (early) return early;
        const body = (await request.json()) as {
          id: string;
          accountId?: string;
          payload: Record<string, unknown>;
        };
        return HttpResponse.json({
          record: {
            id: body.id,
            resource: params.resource,
            ...(body.accountId ? { accountId: body.accountId } : {}),
            rowVersion: 1,
            data: body.payload,
          },
          auditEventId: "audit-demo-1",
          outboxEventId: "outbox-demo-1",
        });
      },
    ),
    http.post(
      `${baseUrl}${COMMERCE_ENDPOINTS.clickAgreement}`,
      lifecycleMutation,
    ),
    http.post(`${baseUrl}${COMMERCE_ENDPOINTS.envelope}`, lifecycleMutation),
    http.post(
      `${baseUrl}/v1/lifecycle/partners/:accountId/domains`,
      lifecycleMutation,
    ),
    http.post(
      `${baseUrl}/v1/lifecycle/exceptions/:caseId/decisions`,
      lifecycleMutation,
    ),
    http.post(`${baseUrl}${COMMERCE_ENDPOINTS.pocs}`, lifecycleMutation),
    http.post(
      `${baseUrl}/v1/lifecycle/pocs/:pocId/conversion`,
      lifecycleMutation,
    ),
    http.post(
      `${baseUrl}/v1/lifecycle/renewals/:orderId/requests`,
      lifecycleMutation,
    ),
    http.post(
      `${baseUrl}/v1/lifecycle/renewals/:orderId/declines`,
      lifecycleMutation,
    ),
    http.post(`${baseUrl}${COMMERCE_ENDPOINTS.termination}`, lifecycleMutation),
    http.get(
      `${baseUrl}/v1/core/reports/:report`,
      async ({ request, params }) => {
        const early = await beforeResponse();
        if (early) return early;
        const format = new URL(request.url).searchParams.get("format");
        if (format === "csv")
          return new HttpResponse(
            `report,source_record_id,amount\n${String(params.report)},order-demo-1,15400\n`,
            { headers: { "content-type": "text/csv" } },
          );
        return HttpResponse.json({
          items: [
            {
              report: params.report,
              sourceRecordId: "order-demo-1",
              amount: "15400",
            },
          ],
          nextCursor: null,
        });
      },
    ),
  ];
}
