import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { uuidV7 } from "@clockwork/contracts";
import {
  formatTraceparent,
  parseTraceparent,
} from "@clockwork/integrations/telemetry";
import {
  demoDeployOptIn,
  findDemoProductionMarker,
} from "@clockwork/testing/demo-state";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  demoAccessRoute,
  isDemoAccessExemptPath,
  verifyDemoAccessCookie,
} from "@/src/auth/demo-access";
import { releaseProofConfiguration } from "@/src/auth/release-proof";
import {
  issueTelemetryIngestCookie,
  telemetryIngestCookieName,
  telemetryIngestSecret,
  telemetryIngestTrace,
} from "@/src/telemetry/ingest-token";
import { runtimeTelemetry } from "@/src/telemetry/runtime";

const workosConfigured = Boolean(
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  process.env.WORKOS_COOKIE_PASSWORD,
);
// A deliberate fixture-only demo deploy serves its own identity, so missing
// provider credentials are expected rather than a misconfiguration. The opt-in
// covers the NODE_ENV that `next build` sets; every other production marker
// still forces the 503.
const demoDeployIdentity =
  demoDeployOptIn(process.env) &&
  process.env.CLOCKWORK_EXPERIENCE_ADAPTER === "demo" &&
  !findDemoProductionMarker(process.env) &&
  process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV?.trim().toLowerCase() !==
    "production";
// A demo deploy is shared by link, so a password stands in front of it. The
// gate is part of the demo identity path alone: without the opt-in, or without
// a configured password, no request is ever inspected or redirected.
const demoAccessSecret = demoAccessConfiguration(process.env);
// Browser telemetry is only accepted with a grant this server minted, so the
// deployment either has a signing secret or has no browser ingest at all.
const telemetryGrantSecret = telemetryIngestSecret(process.env);
const workosProxy = workosConfigured
  ? authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: [
          "/auth/callback",
          "/register",
          "/sign-in",
          "/api/v1/lifecycle/registrations",
          // An enterprise security review starts before first contact and an
          // integrator evaluating the API has no account yet, so a trust page
          // or an API reference behind sign-in is not one. Both routes are pure
          // renders of committed source -- `src/features/trust/trust-register.ts`
          // and the generated OpenAPI contract -- and neither reads a session,
          // a cookie, a header or the database, so there is nothing
          // tenant-specific for an anonymous request to leak.
          // `apps/web/app/trust/page.tsx` and `app/developers/page.tsx` carry
          // the same note, and `route-authentication.test.ts` asserts that this
          // list still contains exactly one `/api/` path.
          "/trust",
          "/developers",
          "/developers/openapi.json",
        ],
      },
      redirectUri:
        process.env.WORKOS_REDIRECT_URI ??
        "http://localhost:3000/auth/callback",
    })
  : undefined;

/**
 * Framing allow-list for the embedded e-signature ceremony. It mirrors
 * `configuredSigningOrigins` in src/features/contracts/provider-navigation.ts,
 * which decides whether a provider URL may be rendered at all; the two are held
 * together by a test rather than an import, because that module reaches into
 * the contracts feature tree and this one runs in front of every request. An
 * unset or malformed setting collapses to 'self', so the ceremony breaks
 * visibly rather than the policy quietly widening to `https:` or `*`.
 */
function signingFrameSources(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const configured = (environment.NEXT_PUBLIC_ESIGN_SIGNING_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        const url = new URL(origin);
        return url.protocol === "https:" ? url.origin : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  if (["development", "test"].includes(environment.NODE_ENV ?? ""))
    configured.push("https://esign.clockwork.test");
  // A demo deploy runs its own ceremony page at `/signing/demo-provider`, so
  // the frame is same-origin there and 'self' is load-bearing, not padding.
  return [...new Set(["'self'", ...configured])];
}

/**
 * Per-request nonce. Next reads it back out of the forwarded
 * `content-security-policy` request header and stamps it onto its own bootstrap
 * script, which is the only inline script the document contains: the app
 * authors none, so `script-src` never needs 'unsafe-inline'.
 */
function contentSecurityNonce(): string | undefined {
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  } catch {
    return undefined;
  }
}

function contentSecurityPolicy(
  nonce: string | undefined,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const production = environment.NODE_ENV === "production";
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    // Without a nonce the framework bootstrap is refused and the page fails
    // visibly. That is the direction to fail in: serving the document with no
    // policy at all would be the quiet outcome, and the wrong one.
    //
    // Everything below the nonce is a NON-PRODUCTION relaxation, each one
    // measured against `next dev` rather than assumed: the dev server compiles
    // and hot-reloads through eval, and it parser-inserts route-group chunks
    // that 'strict-dynamic' refuses because they carry no nonce. Dropping
    // 'strict-dynamic' there falls back to 'self', which is still same-origin
    // only. A built deployment carries neither.
    //
    // The production policy reports exactly one violation, and it stays
    // reported rather than being silenced: Zod's `allowsEval` probe
    // (zod/v4/core/util.js) calls `new Function("")` inside a try/catch to
    // decide whether to compile validators, so the refusal is caught, Zod
    // falls back to its interpreted path, and every page still renders.
    // Widening production script-src to 'unsafe-eval' to quiet one feature
    // probe would give up most of what this policy buys. The clean fix is
    // `core.config({ jitless: true })` in @clockwork/contracts, another lane.
    `script-src ${[
      "'self'",
      ...(nonce ? [`'nonce-${nonce}'`] : []),
      ...(production ? ["'strict-dynamic'"] : ["'unsafe-eval'"]),
    ].join(" ")}`,
    // Production nonces its stylesheets. The dev overlay injects unnonced
    // inline <style> elements, and a nonce makes a browser ignore
    // 'unsafe-inline' outright, so the two cannot be combined: development
    // drops the nonce instead of pretending the relaxation is narrower.
    `style-src ${
      production && nonce ? `'self' 'nonce-${nonce}'` : "'self' 'unsafe-inline'"
    }`,
    // A nonce cannot cover a style ATTRIBUTE, and the design system renders
    // computed `style={{...}}` on charts, meters, and term bars. This is the
    // only 'unsafe-inline' the production policy carries and it reaches
    // attributes alone.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Self-hosted fonts and a same-origin telemetry beacon are the only
    // subresource and network egress the browser performs.
    `connect-src ${["'self'", ...(production ? [] : ["ws:"])].join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self'",
    `frame-src ${signingFrameSources(environment).join(" ")}`,
    // Paired with the X-Frame-Options: DENY next.config.ts already sets, for
    // browsers that honour only one of the two.
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

/**
 * The browser client parents its spans on the traceparent `app/layout.tsx`
 * received for the document, so a telemetry grant follows document navigations
 * and nothing else: rotating it on every RSC fetch would refuse the beacons
 * that a soft navigation goes on to emit. `sec-fetch-dest` decides; the accept
 * header covers the browsers that predate it.
 */
function isDocumentRequest(request: NextRequest): boolean {
  if (request.method !== "GET") return false;
  const destination = request.headers.get("sec-fetch-dest");
  if (destination) return destination === "document";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

function problemResponse(input: {
  status: 421 | 503;
  code: string;
  title: string;
  requestId: string;
  traceparent: string;
}): NextResponse {
  return NextResponse.json(
    {
      type: `https://clockwork.test/problems/${input.code
        .toLowerCase()
        .replaceAll("_", "-")}`,
      title: input.title,
      status: input.status,
      code: input.code,
      requestId: input.requestId,
      retryable: input.status >= 500,
    },
    {
      status: input.status,
      headers: {
        traceparent: input.traceparent,
        "x-request-id": input.requestId,
        "content-type": "application/problem+json",
        "cache-control": "private, no-store",
      },
    },
  );
}

function routeTemplate(pathname: string): string {
  if (pathname.startsWith("/api/v1/webhooks/"))
    return "/api/v1/webhooks/{provider}";
  if (pathname.startsWith("/api/v1/")) return "/api/v1/{lane}/{resource}";
  if (pathname.startsWith("/api/experience/"))
    return "/api/experience/{resource}";
  if (pathname.startsWith("/internal/")) return "/internal/{resource}";
  if (pathname.startsWith("/partner/")) return "/partner/{resource}";
  return "/{portal-route}";
}

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const requestId = uuidV7();
  const parent = parseTraceparent(request.headers.get("traceparent"));
  const span = runtimeTelemetry.startSpan({
    boundary: "server",
    name: "server.request",
    correlation: { requestId },
    attributes: {
      "clockwork.operation": "server.request",
      "http.request.method": request.method,
      "http.route": routeTemplate(request.nextUrl.pathname),
    },
    ...(parent ? { parent } : {}),
  });
  const traceparent = formatTraceparent(span.context());
  const nonce = contentSecurityNonce();
  const policy = contentSecurityPolicy(nonce);
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("traceparent", traceparent);
  forwardedHeaders.set("x-request-id", requestId);
  // The renderer reads the nonce back out of this request header. Both branches
  // below build their forwarded headers from this set, so no path serves a
  // document whose scripts the response policy then refuses.
  forwardedHeaders.set("content-security-policy", policy);
  forwardedHeaders.set("x-nonce", nonce ?? "");
  const tracedRequest = new NextRequest(request, { headers: forwardedHeaders });
  const finish = (status: number, outcome: "ok" | "error" | "denied") => {
    span.setAttributes({
      "http.response.status_code": status,
      "clockwork.outcome": outcome,
    });
    event.waitUntil(
      span.end(outcome === "ok" ? "ok" : "error").catch(() => {}),
    );
  };
  try {
    const releaseProof = releaseProofConfiguration();
    if (
      !workosConfigured &&
      !releaseProof &&
      !demoDeployIdentity &&
      process.env.NODE_ENV === "production"
    ) {
      const unavailable = problemResponse({
        status: 503,
        code: "AUTHENTICATION_NOT_CONFIGURED",
        title: "Authentication is not configured",
        requestId,
        traceparent,
      });
      finish(503, "error");
      return unavailable;
    }
    if (
      demoAccessSecret &&
      !isDemoAccessExemptPath(request.nextUrl.pathname) &&
      !(await verifyDemoAccessCookie(
        request.cookies.get(demoAccessCookieName)?.value,
        demoAccessSecret,
      ))
    ) {
      const gate = new URL(demoAccessRoute, request.nextUrl.origin);
      gate.searchParams.set(
        "next",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      const locked = NextResponse.redirect(gate, {
        status: 302,
        headers: {
          traceparent,
          "x-request-id": requestId,
          "cache-control": "private, no-store",
        },
      });
      finish(302, "denied");
      return locked;
    }
    // Provider callbacks authenticate with their raw-body signature. Keeping the
    // namespace outside AuthKit lets lanes add Stripe/e-sign routes without a
    // shared proxy edit; Hono still requires verifier-backed handlers.
    const isWebhook = request.nextUrl.pathname.startsWith("/api/v1/webhooks/");
    let response: NextResponse;
    if (releaseProof) {
      if (request.nextUrl.origin !== releaseProof.origin) {
        const denied = problemResponse({
          status: 421,
          code: "RELEASE_PROOF_ORIGIN_REJECTED",
          title: "Release-proof origin is not authorized",
          requestId,
          traceparent,
        });
        finish(421, "denied");
        return denied;
      }
      const trustedRequestHeaders = new Headers(forwardedHeaders);
      trustedRequestHeaders.delete("x-clockwork-proof-origin");
      trustedRequestHeaders.set(
        "x-clockwork-proof-origin",
        releaseProof.origin,
      );
      response = NextResponse.next({
        request: { headers: trustedRequestHeaders },
      });
    } else {
      const authResponse =
        workosProxy && !isWebhook
          ? await workosProxy(tracedRequest, event)
          : undefined;
      response =
        authResponse instanceof NextResponse
          ? authResponse
          : authResponse instanceof Response
            ? new NextResponse(authResponse.body, authResponse)
            : NextResponse.next({ request: { headers: forwardedHeaders } });
    }
    if (!request.cookies.has("clockwork-csrf"))
      response.cookies.set(
        "clockwork-csrf",
        crypto.randomUUID().replaceAll("-", ""),
        {
          httpOnly: false,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
        },
      );
    // The grant carries parentage /api/telemetry will attach browser records
    // to. It is the `server.request` context ONLY when this server generated
    // that context: `startSpan` adopts `parent.traceId` verbatim, so a request
    // that arrived carrying a `traceparent` names a trace the caller chose, and
    // signing that would hand any caller a grant for any trace id they could
    // read off a response header. `telemetryIngestTrace` draws a fresh one in
    // that case. The grant is also bound to the csrf cookie this browser holds
    // -- the one set immediately above when it was absent, so a first visit
    // binds to the value the browser is about to receive rather than to
    // nothing. It is httpOnly: unlike the csrf token no script needs to read
    // it, and the beacon already travels with `credentials: "same-origin"`.
    if (telemetryGrantSecret && isDocumentRequest(request)) {
      const grant = await issueTelemetryIngestCookie({
        trace: telemetryIngestTrace({
          span: span.context(),
          adoptedIncomingTraceparent: Boolean(parent),
        }),
        browserBinding:
          response.cookies.get("clockwork-csrf")?.value ??
          request.cookies.get("clockwork-csrf")?.value,
        secret: telemetryGrantSecret,
      });
      if (grant)
        response.cookies.set(telemetryIngestCookieName, grant.value, {
          httpOnly: true,
          sameSite: "strict",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          expires: new Date(grant.expiresAt),
        });
    }
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("content-security-policy", policy);
    response.headers.set("traceparent", traceparent);
    response.headers.set("x-request-id", requestId);
    finish(response.status, response.status >= 500 ? "error" : "ok");
    return response;
  } catch (error) {
    span.recordError(error);
    finish(500, "error");
    throw error;
  }
}
// Brand assets stay outside the authenticated surface: the favicon, the app
// icons, and the Open Graph card are fetched by browsers before sign-in and by
// link unfurlers that never hold a session, so an auth redirect would silently
// replace them with a sign-in page. Every exemption names a static asset path.
export const config = {
  matcher: [
    {
      // Netlify's Next edge handoff can consume raw request bodies even when
      // middleware returns an unmodified pass-through. Both API namespaces and
      // the narrowly scoped demo payment namespace go directly to
      // self-authenticating route boundaries. Server Actions also bypass this
      // proxy, then authenticate from their sealed session or demo grant and
      // enforce release-proof origin at the destination.
      source:
        "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|opengraph-image.png|brand/|demo/access/submit|signing/demo-provider/complete|api/(?:v1|experience)(?:/|$)|api/demo/payments(?:/|$)).*)",
      missing: [
        { type: "header", key: "next-action" },
        {
          type: "header",
          key: "content-type",
          value: "multipart/form-data.*",
        },
        {
          type: "header",
          key: "content-type",
          value: "application/x-www-form-urlencoded.*",
        },
      ],
    },
  ],
};
