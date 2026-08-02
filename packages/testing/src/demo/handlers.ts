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
  registration: "/v1/lifecycle/registrations",
  memberInvite: "/v1/lifecycle/organizations/{organizationId}/invites",
  procurementProfile: "/v1/lifecycle/accounts/{accountId}/procurement-profile",
  agreementTemplate: "/v1/lifecycle/agreement-templates",
  activeAgreementTemplate: "/v1/lifecycle/agreement-templates/active",
  clickAgreement: "/v1/lifecycle/agreements/click-through",
  envelope: "/v1/lifecycle/agreements/envelopes",
  partnerDomain: "/v1/lifecycle/partners/{accountId}/domains",
  exceptionDecision: "/v1/lifecycle/exceptions/{caseId}/decisions",
  pocs: "/v1/lifecycle/pocs",
  pocConversion: "/v1/lifecycle/pocs/{pocId}/conversion",
  renewalRequest: "/v1/lifecycle/renewals/{orderId}/requests",
  renewalDecline: "/v1/lifecycle/renewals/{orderId}/declines",
  termination: "/v1/lifecycle/terminations",
  paymentSession: "/v1/core/payment-sessions",
  report: "/v1/core/reports/{report}",
} as const;

/**
 * The click-through surface recomputes the SHA-256 of the text it received and
 * refuses to execute when the digest disagrees, so the demo template carries a
 * true digest of its own exact text. Editing the text requires recomputing the
 * hash, and handlers.test.ts holds the two together.
 */
export const DEMO_AGREEMENT_TEXT =
  "Fil One Commercial Services Agreement (demo). This click-through text is fixture data served by the demo adapter and creates no obligation." as const;
export const DEMO_AGREEMENT_TEXT_HASH =
  "9118d9f85685227fade3581bd470c63e75a52ec75b9babe2fdc9bdaef9001a12" as const;

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
      `${baseUrl}${COMMERCE_ENDPOINTS.registration}`,
      lifecycleMutation,
    ),
    http.post(
      `${baseUrl}/v1/lifecycle/organizations/:organizationId/invites`,
      lifecycleMutation,
    ),
    http.put(
      `${baseUrl}/v1/lifecycle/accounts/:accountId/procurement-profile`,
      lifecycleMutation,
    ),
    http.post(
      `${baseUrl}${COMMERCE_ENDPOINTS.agreementTemplate}`,
      lifecycleMutation,
    ),
    http.get(
      `${baseUrl}${COMMERCE_ENDPOINTS.activeAgreementTemplate}`,
      async ({ request }) => {
        const early = await beforeResponse();
        if (early) return early;
        const query = new URL(request.url).searchParams;
        return HttpResponse.json({
          id: "55555555-5555-4555-8555-555555555555",
          type: query.get("type") ?? "csa",
          semanticVersion: "3.1.0",
          jurisdiction: query.get("jurisdiction") ?? "US",
          effectiveOn: "2026-01-01",
          canonicalDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          exactText: DEMO_AGREEMENT_TEXT,
          exactTextHash: DEMO_AGREEMENT_TEXT_HASH,
          executionMode: "click_through",
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
    // Checkout is the one operation the demo declines rather than simulates.
    // The panel only follows a payment URL whose origin is a pinned provider,
    // and a fixture that moved money in a prospect's browser would be worse
    // than an honest refusal.
    http.post(
      `${baseUrl}${COMMERCE_ENDPOINTS.paymentSession}`,
      async ({ request }) => {
        const early = await beforeResponse(request);
        if (early) return early;
        return HttpResponse.json(
          {
            type: "https://clockwork.test/problems/demo-payment-unavailable",
            title: "Payment checkout is not available in the demo",
            status: 503,
            detail:
              "The demo never contacts a payment provider, so no checkout session exists.",
            code: "DEMO_PAYMENT_UNAVAILABLE",
            requestId: request.headers.get("x-request-id") ?? "demo",
            retryable: false,
          },
          {
            status: 503,
            headers: { "content-type": "application/problem+json" },
          },
        );
      },
    ),
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
