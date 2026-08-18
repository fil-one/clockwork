import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Telemetry from "@clockwork/integrations/telemetry";

const telemetry = vi.hoisted(() => ({
  exports: [] as Array<
    Array<{
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      name: string;
      boundary: string;
    }>
  >,
  spans: [] as Array<{
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    boundary: string;
  }>,
}));

vi.mock("@/src/telemetry/runtime", async () => {
  const actual = await vi.importActual<typeof Telemetry>(
    "@clockwork/integrations/telemetry",
  );
  const sink = {
    export: (
      spans: readonly (typeof telemetry.spans)[number][],
    ): Promise<void> => {
      const exported = spans.map((span) => structuredClone(span));
      telemetry.exports.push(exported);
      telemetry.spans.push(...exported);
      return Promise.resolve();
    },
  };
  return {
    runtimeBoundaryInstrumentation: new actual.RuntimeBoundaryInstrumentation(
      new actual.ClockworkTelemetry(sink),
    ),
  };
});

vi.mock("@workos-inc/authkit-nextjs", () => ({
  applyResponseHeaders: (response: Response) => response,
  authkit: vi.fn(),
  getTokenClaims: vi.fn(),
  isAuthkitRequestHeader: () => false,
  partitionAuthkitHeaders: () => ({
    requestHeaders: new Headers(),
    responseHeaders: new Headers(),
  }),
}));

vi.mock("./demo-access", () => ({
  demoAccessConfiguration: () => undefined,
  demoAccessCookieName: "clockwork-demo-access",
  verifyDemoAccessCookie: () => Promise.resolve(true),
}));
vi.mock("./demo-deploy", () => ({
  demoDeployIdentityEnabled: () => true,
}));
vi.mock("./release-proof", () => ({
  releaseProofConfiguration: () => undefined,
}));
vi.mock("./session", () => ({
  workosAuthenticationConfigured: () => false,
}));

import { runtimeBoundaryInstrumentation } from "@/src/telemetry/runtime";
import type { WorkosNextSessionResolver } from "./session";
import { withRawApiAuthentication } from "./raw-api-boundary";

const resolver = {
  bindVerifiedSession: vi.fn(),
} as unknown as WorkosNextSessionResolver;

beforeEach(() => {
  telemetry.exports.length = 0;
  telemetry.spans.length = 0;
  vi.clearAllMocks();
});

describe("raw API telemetry replacement boundary", () => {
  it("returns a server span that is also exported as the API span's parent", async () => {
    const response = await withRawApiAuthentication({
      request: new Request("https://app.example/api/experience/projections"),
      sessionResolver: resolver,
      telemetryRoute: "/api/experience/{resource}",
      dispatch: (_request, requestId) =>
        runtimeBoundaryInstrumentation.api({
          name: "api.request",
          correlation: { requestId },
          operation: () => Promise.resolve(Response.json({ ok: true })),
        }),
    });

    const traceparent = response.headers.get("traceparent");
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u);
    const [, traceId, responseSpanId] = traceparent?.split("-") ?? [];
    const server = telemetry.spans.find(
      (span) => span.boundary === "server" && span.name === "server.request",
    );
    const api = telemetry.spans.find(
      (span) => span.boundary === "api" && span.name === "api.request",
    );
    expect(server).toMatchObject({ traceId, spanId: responseSpanId });
    expect(api).toMatchObject({ traceId, parentSpanId: responseSpanId });
    expect(
      telemetry.spans.filter((span) =>
        JSON.stringify(span).includes(responseSpanId ?? "not-present"),
      ),
    ).toHaveLength(2);
    // The OTLP sink receives each ended boundary separately, matching the
    // release proof's count of HTTP export payloads rather than merely two
    // records coalesced into one payload.
    expect(
      telemetry.exports.filter((batch) =>
        JSON.stringify(batch).includes(responseSpanId ?? "not-present"),
      ),
    ).toHaveLength(2);
  });

  it("adds the replacement span without consuming the raw body", async () => {
    const rawBody = '{"marker":"naïve 雪"}';
    const response = await withRawApiAuthentication({
      request: new Request("https://app.example/api/v1/core/commands/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rawBody,
      }),
      targetUrl: new URL("https://app.example/v1/core/commands/quotes"),
      sessionResolver: resolver,
      telemetryRoute: "/v1/{lane}/{resource}",
      dispatch: (request, requestId) =>
        runtimeBoundaryInstrumentation.api({
          name: "api.request",
          correlation: { requestId },
          operation: async () => Response.json({ body: await request.text() }),
        }),
    });

    await expect(response.json()).resolves.toEqual({ body: rawBody });
    expect(response.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u,
    );
  });
});
