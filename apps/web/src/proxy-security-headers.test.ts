import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProblemDetailsSchema } from "@clockwork/contracts";

import {
  telemetryIngestCookieName,
  verifyTelemetryIngestCookie,
} from "@/src/telemetry/ingest-token";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() => vi.fn()),
}));

const telemetrySecret = "proxy-telemetry-ingest-secret-of-ample-length";
vi.stubEnv("CLOCKWORK_TELEMETRY_INGEST_SECRET", telemetrySecret);
vi.stubEnv("NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS", "https://esign.example.test");

const proxyModule = await import("../proxy");
const proxy = proxyModule.default;
const proxyConfig = proxyModule.config;

function event() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    value: {
      waitUntil(promise: Promise<unknown>) {
        pending.push(promise);
      },
    },
  };
}

type Proxy = typeof proxy;

async function documentResponse(
  path = "/",
  headers: Record<string, string> = { "sec-fetch-dest": "document" },
  through: Proxy = proxy,
) {
  const scheduled = event();
  const response = await through(
    new NextRequest(`http://localhost:3000${path}`, { headers }),
    scheduled.value as never,
  );
  await Promise.all(scheduled.pending);
  return response;
}

/**
 * The proxy reads its deployment shape once, at import. A built demo deploy is
 * the shape the policy actually ships in, so the production assertions run
 * against a freshly imported module in that shape rather than against the test
 * runner's NODE_ENV.
 */
async function productionProxy(): Promise<Proxy> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
  return (await import("../proxy")).default;
}

async function productionDirectives(): Promise<Map<string, string>> {
  const built = await productionProxy();
  const response = await documentResponse("/", undefined, built);
  expect(response.status).toBe(200);
  return directives(response.headers.get("content-security-policy") ?? "");
}

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name ?? "", sources.join(" ")];
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CLOCKWORK_TELEMETRY_INGEST_SECRET", telemetrySecret);
  vi.stubEnv("NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS", "https://esign.example.test");
});

describe("content security policy", () => {
  it("keeps the complete exact-byte v1 API boundary outside the proxy", () => {
    const matches = (pathname: string) =>
      unstable_doesMiddlewareMatch({
        config: proxyConfig,
        url: `https://demo.clockwork.test${pathname}`,
      });

    expect(matches("/api/v1")).toBe(false);
    expect(matches("/api/v1/")).toBe(false);
    expect(matches("/api/v1/core/commands/orders")).toBe(false);
    expect(matches("/api/v1/core/commands/quotes")).toBe(false);
    expect(matches("/api/v1/webhooks")).toBe(false);
    expect(matches("/api/v1/webhooks/stripe")).toBe(false);
    // Similar prefixes are not part of the v1 namespace.
    expect(matches("/api/v1x/core/commands/orders")).toBe(true);
    expect(matches("/customer/dashboard")).toBe(true);
    expect(matches("/brand/clockwork.svg")).toBe(false);
  });

  it("serves a nonce policy on the response and forwards it to the renderer", async () => {
    const response = await documentResponse();
    const policy = response.headers.get("content-security-policy");
    expect(policy).toBeTruthy();
    // Next reads the nonce back out of the request header it forwards.
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);

    const parsed = directives(policy ?? "");
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(
      parsed.get("script-src") ?? "",
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    // The application authors no inline scripts, so there is no justification
    // for widening script execution to every inline block on the page.
    expect(parsed.get("script-src")).not.toContain("'unsafe-inline'");
    // Attribute styles are the one place a nonce cannot reach.
    expect(parsed.get("style-src-attr")).toBe("'unsafe-inline'");
    expect(parsed.get("default-src")).toBe("'self'");
    expect(parsed.get("base-uri")).toBe("'none'");
    expect(parsed.get("object-src")).toBe("'none'");
    expect(parsed.get("frame-ancestors")).toBe("'none'");
    expect(parsed.get("form-action")).toBe("'self'");
    expect(parsed.get("connect-src")).toContain("'self'");
  });

  it("keeps the dev-server relaxations out of the built policy", async () => {
    // `next dev` needs eval and parser-inserts unnonced chunks; the dev overlay
    // injects unnonced inline styles. Each relaxation is scoped to a
    // non-production NODE_ENV, and this is the assertion that keeps it scoped.
    const development = directives(
      (await documentResponse()).headers.get("content-security-policy") ?? "",
    );
    expect(development.get("script-src")).toContain("'unsafe-eval'");
    expect(development.get("script-src")).not.toContain("'strict-dynamic'");
    expect(development.get("style-src")).toContain("'unsafe-inline'");
    expect(development.get("connect-src")).toContain("ws:");

    const built = await productionDirectives();
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(
      built.get("script-src") ?? "",
    )?.[1];
    expect(nonce).toBeTruthy();
    expect(built.get("script-src")).toBe(
      `'self' 'nonce-${nonce}' 'strict-dynamic'`,
    );
    expect(built.get("style-src")).toBe(`'self' 'nonce-${nonce}'`);
    expect(built.get("connect-src")).toBe("'self'");
    expect(built.has("upgrade-insecure-requests")).toBe(true);
  });

  it("mints a fresh nonce per request", async () => {
    const [first, second] = await Promise.all([
      documentResponse(),
      documentResponse(),
    ]);
    expect(first.headers.get("x-middleware-request-x-nonce")).not.toBe(
      second.headers.get("x-middleware-request-x-nonce"),
    );
  });

  it("frames only the configured signing origins and self", async () => {
    const parsed = directives(
      (await documentResponse()).headers.get("content-security-policy") ?? "",
    );
    expect(parsed.get("frame-src")?.split(" ")).toEqual(
      expect.arrayContaining(["'self'", "https://esign.example.test"]),
    );
  });

  it("frames exactly the origins the provider allow-list will render", async () => {
    // The two derive the list independently; this is what keeps them honest.
    const { trustedSigningUrl } =
      await import("@/src/features/contracts/provider-navigation");
    const framed = (
      directives(
        (await documentResponse()).headers.get("content-security-policy") ?? "",
      ).get("frame-src") ?? ""
    )
      .split(" ")
      .filter((source) => source !== "'self'");
    for (const origin of framed)
      expect(trustedSigningUrl(`${origin}/envelope`)).toBe(
        `${origin}/envelope`,
      );
    expect(() =>
      trustedSigningUrl("https://attacker.example/envelope"),
    ).toThrow();
  });

  it("collapses frame-src to self when the setting is absent or malformed", async () => {
    vi.stubEnv("NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS", "not a url, http://plain");
    const malformed = directives(
      (await documentResponse()).headers.get("content-security-policy") ?? "",
    );
    // The e-signature frame breaks visibly rather than the policy widening.
    expect(malformed.get("frame-src")?.split(" ")).not.toContain(
      "http://plain",
    );
    expect(malformed.get("frame-src")?.split(" ")).not.toContain("https:");

    vi.stubEnv("NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS", "");
    const absent = directives(
      (await documentResponse()).headers.get("content-security-policy") ?? "",
    );
    expect(absent.get("frame-src")?.split(" ")).not.toContain("*");
    // Under NODE_ENV=test the local ceremony host is the only other source.
    expect(absent.get("frame-src")?.split(" ")).toEqual([
      "'self'",
      "https://esign.clockwork.test",
    ]);
  });
});

describe("telemetry ingest grant", () => {
  it("mints parentage this server generated when no traceparent arrived", async () => {
    const response = await documentResponse();
    const cookie = response.cookies.get(telemetryIngestCookieName);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("strict");

    const traceparent = response.headers.get("traceparent") ?? "";
    const [, traceId, spanId] = traceparent.split("-");
    await expect(
      verifyTelemetryIngestCookie({
        value: cookie?.value,
        browserBinding: response.cookies.get("clockwork-csrf")?.value,
        secret: telemetrySecret,
      }),
    ).resolves.toMatchObject({ traceId, spanId });
  });

  it("refuses to sign a trace id the caller named", async () => {
    // The refuted attack: a caller sends its own traceparent, the proxy span
    // adopts that trace id verbatim, and the grant used to sign it back.
    const named = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const response = await documentResponse("/", {
      "sec-fetch-dest": "document",
      traceparent: `00-${named}-bbbbbbbbbbbbbbbb-01`,
    });
    expect(response.headers.get("traceparent")).toContain(named);
    const grant = await verifyTelemetryIngestCookie({
      value: response.cookies.get(telemetryIngestCookieName)?.value,
      browserBinding: response.cookies.get("clockwork-csrf")?.value,
      secret: telemetrySecret,
    });
    expect(grant?.traceId).toBeDefined();
    expect(grant?.traceId).not.toBe(named);
  });

  it("binds the grant to the csrf cookie this browser holds", async () => {
    const response = await documentResponse();
    await expect(
      verifyTelemetryIngestCookie({
        value: response.cookies.get(telemetryIngestCookieName)?.value,
        browserBinding: "f".repeat(32),
        secret: telemetrySecret,
      }),
    ).resolves.toBeUndefined();
  });

  it("mints no grant for a request that is not a document navigation", async () => {
    const beacon = await documentResponse("/api/telemetry", {
      "sec-fetch-dest": "empty",
    });
    expect(beacon.cookies.get(telemetryIngestCookieName)).toBeUndefined();
  });
});

describe("middleware refusals", () => {
  it("refuses an unconfigured production deployment with an RFC 9457 body", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "");
    vi.stubEnv("CLOCKWORK_RELEASE_PROOF", "0");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "database");
    const { default: unconfigured } = await import("../proxy");

    const scheduled = event();
    const response = await unconfigured(
      new NextRequest("http://localhost:3000/internal/dashboard"),
      scheduled.value as never,
    );
    await Promise.all(scheduled.pending);

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(ProblemDetailsSchema.parse(await response.json())).toMatchObject({
      code: "AUTHENTICATION_NOT_CONFIGURED",
      status: 503,
      retryable: true,
    });
    vi.resetModules();
  });
});
