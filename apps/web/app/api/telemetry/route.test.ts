import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";

import { ProblemDetailsSchema } from "@clockwork/contracts";

import {
  issueTelemetryIngestCookie,
  telemetryIngestCookieName,
} from "@/src/telemetry/ingest-token";
import { runtimeTelemetrySink } from "@/src/telemetry/runtime";

const { caller } = vi.hoisted(() => ({
  caller: { resolves: true, identities: 0 },
}));

// The route resolves identity through the same helpers the rest of the app
// uses; neither reads a plain `Request`, so both are stubbed here. The demo
// resolver hands back a DIFFERENT identity on every call, which is the shape
// the live refutation exploited: the real one takes its persona from the
// caller's own `x-clockwork-persona` header. Nothing the route does may depend
// on the value.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn(() => Promise.resolve({ user: null })),
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: vi.fn(() => {
    if (!caller.resolves)
      // Matches the resolver's behaviour when a deployment has no identity
      // model configured: it throws rather than returning an empty session.
      return Promise.reject(new Error("Authentication is unavailable"));
    caller.identities += 1;
    return Promise.resolve({
      userId: `20000000-0000-4000-8000-00000000${String(caller.identities).padStart(4, "0")}`,
      authenticationSessionId: `session-${caller.identities}`,
    });
  }),
}));

vi.stubEnv(
  "CLOCKWORK_TELEMETRY_INGEST_SECRET",
  "telemetry-ingest-test-secret-of-ample-length",
);

const { POST } = await import("./route");

const token = "0123456789abcdef0123456789abcdef";
const grantedTraceId = "4bf92f3577b34da6a3ce929d0e0e4736";
const grantedSpanId = "1111111111111111";
// The trace id a caller names on the wire. It is never the granted one, so any
// record that reaches the sink carrying it proves caller parentage was honoured.
const namedTraceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const grant = await issueTelemetryIngestCookie({
  trace: { traceId: grantedTraceId, spanId: grantedSpanId },
  browserBinding: token,
  secret: "telemetry-ingest-test-secret-of-ample-length",
});

function record(trace: Record<string, string> = {}) {
  return {
    schemaUrl: "https://opentelemetry.io/schemas/1.30.0",
    resource: {
      "service.name": "clockwork-web",
      "service.version": "release-1",
      "deployment.environment.name": "test",
    },
    scope: { name: "@clockwork/web", version: "1" },
    signal: "span",
    name: "document.load",
    timeUnixNano: "1722443200000000000",
    trace: {
      traceId: grantedTraceId,
      spanId: "00f067aa0ba902b7",
      parentSpanId: grantedSpanId,
      traceFlags: "01",
      ...trace,
    },
    attributes: {
      "app.route": "/accounts/11111111-1111-4111-8111-111111111111?secret=yes",
      password: "do-not-export",
    },
  };
}

function request(
  body: unknown,
  csrf = token,
  telemetryGrant: string | null = grant?.value ?? null,
) {
  return new Request("http://localhost:3000/api/telemetry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: [
        `clockwork-csrf=${token}`,
        ...(telemetryGrant
          ? [`${telemetryIngestCookieName}=${telemetryGrant}`]
          : []),
      ].join("; "),
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
      traceparent: `00-${namedTraceId}-00f067aa0ba902b7-01`,
      "x-clockwork-csrf": csrf,
    },
    body: JSON.stringify(body),
  });
}

// The receiver span always reaches the sink; only a *browser* span means a
// caller's record was forwarded to the collector.
function forwardedBrowserSpans(
  exported: MockInstance<typeof runtimeTelemetrySink.export>,
) {
  return exported.mock.calls
    .flatMap(([spans]) => spans)
    .filter((span) => span.boundary === "browser");
}

async function problemOf(response: Response) {
  expect(response.headers.get("content-type")).toBe("application/problem+json");
  return ProblemDetailsSchema.parse(await response.json());
}

beforeEach(() => {
  caller.resolves = true;
});

describe("browser telemetry ingestion", () => {
  it("accepts a correlated, redacted envelope", async () => {
    expect((await POST(request(record()))).status).toBe(202);
  });

  it("rejects cross-site and unknown signal data", async () => {
    expect((await POST(request(record(), "f".repeat(32)))).status).toBe(403);
    expect(
      (await POST(request({ ...record(), name: "api_key=secret" }))).status,
    ).toBe(422);
  });

  it("accepts a browser Origin that matches the Host it was sent to", async () => {
    // A built deployment answers on the host the browser asked for while the
    // route's own `request.url` says localhost, so comparing the two refuses
    // every real beacon. The Host header is what closes that gap.
    const deployed = new Request(
      "https://commerce.example.test/api/telemetry",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `clockwork-csrf=${token}; ${telemetryIngestCookieName}=${grant?.value}`,
          host: "commerce.example.test",
          origin: "https://commerce.example.test",
          "sec-fetch-site": "same-origin",
          "x-clockwork-csrf": token,
        },
        body: JSON.stringify(record()),
      },
    );
    expect((await POST(deployed)).status).toBe(202);
  });

  it("refuses a foreign or opaque Origin on the same Host", async () => {
    for (const origin of ["https://attacker.example", "null"]) {
      const foreign = new Request(
        "https://commerce.example.test/api/telemetry",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `clockwork-csrf=${token}; ${telemetryIngestCookieName}=${grant?.value}`,
            host: "commerce.example.test",
            origin,
            "x-clockwork-csrf": token,
          },
          body: JSON.stringify(record()),
        },
      );
      const response = await POST(foreign);
      expect(response.status).toBe(403);
      expect((await problemOf(response)).code).toBe(
        "TELEMETRY_ORIGIN_REJECTED",
      );
    }
  });

  it("rejects non-ASCII and malformed CSRF tokens without throwing", async () => {
    expect((await POST(request(record(), "é".repeat(32)))).status).toBe(403);
    expect((await POST(request(record(), "a".repeat(31)))).status).toBe(403);
  });

  it("records a failed receiver span when the sink cannot deliver", async () => {
    const exported = vi
      .spyOn(runtimeTelemetrySink, "export")
      .mockRejectedValue(new Error("collector unavailable"));
    try {
      const response = await POST(request(record()));
      expect(response.status).toBe(503);
      expect((await problemOf(response)).retryable).toBe(true);
      const browserSpan = exported.mock.calls[0]?.[0]?.[0];
      const receiverSpan = exported.mock.calls.at(-1)?.[0]?.[0];
      expect(browserSpan).toMatchObject({
        name: "document.load",
        traceId: grantedTraceId,
        parentSpanId: grantedSpanId,
      });
      // The receiver span keeps its own parentage on the incoming traceparent,
      // which is the behaviour the backlog records as resolved.
      expect(receiverSpan).toMatchObject({
        name: "api.telemetry_ingest",
        boundary: "api",
        traceId: namedTraceId,
        parentSpanId: "00f067aa0ba902b7",
        status: "error",
      });
      expect(receiverSpan?.attributes["clockwork.outcome"]).toBe("error");
    } finally {
      exported.mockRestore();
    }
  });

  it("rejects an oversized body even when content-length is absent", async () => {
    expect(
      (
        await POST(
          request({
            ...record(),
            attributes: { padding: "x".repeat(33_000) },
          }),
        )
      ).status,
    ).toBe(413);
  });

  it("refuses an anonymous caller holding a valid CSRF pair", async () => {
    caller.resolves = false;
    const exported = vi.spyOn(runtimeTelemetrySink, "export");
    try {
      const response = await POST(request(record()));
      expect(response.status).toBe(403);
      expect((await problemOf(response)).code).toBe(
        "TELEMETRY_SESSION_REQUIRED",
      );
      expect(forwardedBrowserSpans(exported)).toEqual([]);
    } finally {
      exported.mockRestore();
    }
  });

  /**
   * Fails against the unfixed route, which exported the receiver span for every
   * refusal: five anonymous posts produced five span batches the meter never
   * saw, so refusing was itself a way to drive collector volume.
   */
  it("exports nothing at all for a refused request", async () => {
    caller.resolves = false;
    const exported = vi.spyOn(runtimeTelemetrySink, "export");
    try {
      for (let attempt = 0; attempt < 5; attempt += 1)
        expect((await POST(request(record()))).status).toBe(403);
      expect(exported).not.toHaveBeenCalled();
      // Nor for a caller with no grant, nor a caller with no csrf pair.
      expect((await POST(request(record(), token, null))).status).toBe(403);
      expect((await POST(request(record(), "f".repeat(32)))).status).toBe(403);
      expect(exported).not.toHaveBeenCalled();
    } finally {
      exported.mockRestore();
    }
  });

  /**
   * The live refutation: mint a grant by naming a trace on the document
   * request, then post a `browser.error` into that trace with no parent at all.
   * The unfixed route returned 202 and forwarded the record with the caller's
   * trace id and the caller's span id intact.
   */
  it("attaches a record to the granted trace, never the one the caller names", async () => {
    const exported = vi.spyOn(runtimeTelemetrySink, "export");
    try {
      const forged = record({
        traceId: namedTraceId,
        spanId: "deadbeefdeadbeef",
      });
      delete (forged.trace as Record<string, string>).parentSpanId;
      expect((await POST(request(forged))).status).toBe(202);
      const [browserSpan] = forwardedBrowserSpans(exported);
      expect(browserSpan?.traceId).toBe(grantedTraceId);
      expect(browserSpan?.parentSpanId).toBe(grantedSpanId);
      expect(browserSpan?.spanId).not.toBe("deadbeefdeadbeef");
      expect(browserSpan?.spanId).toMatch(/^[0-9a-f]{16}$/);
    } finally {
      exported.mockRestore();
    }
  });

  it("never lets a caller claim the span id the grant was minted for", async () => {
    const exported = vi.spyOn(runtimeTelemetrySink, "export");
    try {
      expect(
        (await POST(request(record({ spanId: grantedSpanId })))).status,
      ).toBe(202);
      const [browserSpan] = forwardedBrowserSpans(exported);
      expect(browserSpan?.spanId).not.toBe(grantedSpanId);
    } finally {
      exported.mockRestore();
    }
  });

  it("refuses a grant minted for another browser, and a missing grant", async () => {
    const otherBrowser = await issueTelemetryIngestCookie({
      trace: { traceId: grantedTraceId, spanId: grantedSpanId },
      browserBinding: "f".repeat(32),
      secret: "telemetry-ingest-test-secret-of-ample-length",
    });
    for (const value of [otherBrowser?.value, null, "not-a-signed-grant"]) {
      const response = await POST(request(record(), token, value ?? null));
      expect(response.status).toBe(403);
      expect((await problemOf(response)).code).toBe(
        "TELEMETRY_TRACE_UNVERIFIED",
      );
    }
  });

  it("refuses ingest outright when no signing secret is configured", async () => {
    vi.stubEnv("CLOCKWORK_TELEMETRY_INGEST_SECRET", "");
    try {
      const response = await POST(request(record()));
      expect(response.status).toBe(403);
      expect((await problemOf(response)).code).toBe(
        "TELEMETRY_TRACE_UNVERIFIED",
      );
    } finally {
      vi.stubEnv(
        "CLOCKWORK_TELEMETRY_INGEST_SECRET",
        "telemetry-ingest-test-secret-of-ample-length",
      );
    }
  });

  it("returns RFC 9457 problem bodies for every refusal", async () => {
    const cases: [Promise<Response>, number, string][] = [
      [
        POST(request(record(), "f".repeat(32))),
        403,
        "TELEMETRY_ORIGIN_REJECTED",
      ],
      [
        POST(
          new Request("http://localhost:3000/api/telemetry", {
            method: "POST",
            headers: {
              "content-type": "text/plain",
              cookie: `clockwork-csrf=${token}; ${telemetryIngestCookieName}=${grant?.value}`,
              origin: "http://localhost:3000",
              "sec-fetch-site": "same-origin",
              "x-clockwork-csrf": token,
            },
            body: "not json",
          }),
        ),
        415,
        "TELEMETRY_MEDIA_TYPE",
      ],
      [
        POST(request({ ...record(), name: "api_key=secret" })),
        422,
        "TELEMETRY_ENVELOPE_INVALID",
      ],
      [
        POST(request({ ...record(), attributes: { pad: "x".repeat(33_000) } })),
        413,
        "TELEMETRY_PAYLOAD_TOO_LARGE",
      ],
    ];
    for (const [pending, status, code] of cases) {
      const response = await pending;
      expect(response.status).toBe(status);
      const problem = await problemOf(response);
      expect(problem).toMatchObject({ status, code, retryable: false });
      expect(problem.requestId.length).toBeGreaterThanOrEqual(8);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  /**
   * Last in the file on purpose: it exhausts the one shared window and the
   * window is module state.
   *
   * Fails against the unfixed route, which keyed the meter on the identity
   * `getCommerceSession()` returned. The stub hands back a fresh identity on
   * every call -- the unit equivalent of rotating `x-clockwork-persona` through
   * the nine-persona catalog, which was proven live -- so the unfixed route
   * opened a new window per request and never reached 429 at all.
   */
  it("meters a deployment that cannot name its callers on one shared window", async () => {
    const before = caller.identities;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 700; attempt += 1)
      statuses.push((await POST(request(record()))).status);
    expect(statuses).toContain(429);
    expect(statuses.filter((status) => status === 202).length).toBeLessThan(
      600,
    );
    // The resolver was consulted every time and its answer changed every time,
    // and none of that reached the key.
    expect(caller.identities - before).toBeGreaterThan(600);
    expect(await problemOf(await POST(request(record())))).toMatchObject({
      code: "TELEMETRY_RATE_LIMITED",
      retryable: true,
    });
  });
});
