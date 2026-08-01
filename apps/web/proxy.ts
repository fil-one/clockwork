import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent } from "next/server";
import { NextRequest, NextResponse } from "next/server";

import { uuidV7 } from "@clockwork/contracts";
import { formatTraceparent, parseTraceparent } from "@clockwork/integrations";

import { releaseProofConfiguration } from "@/src/auth/release-proof";
import { runtimeTelemetry } from "@/src/telemetry/runtime";

const workosConfigured = Boolean(
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  process.env.WORKOS_COOKIE_PASSWORD,
);
const workosProxy = workosConfigured
  ? authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: [
          "/auth/callback",
          "/register",
          "/sign-in",
          "/api/v1/lifecycle/registrations",
        ],
      },
      redirectUri:
        process.env.WORKOS_REDIRECT_URI ??
        "http://localhost:3000/auth/callback",
    })
  : undefined;

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
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("traceparent", traceparent);
  forwardedHeaders.set("x-request-id", requestId);
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
      process.env.NODE_ENV === "production"
    ) {
      const unavailable = NextResponse.json(
        { title: "Authentication is not configured", status: 503 },
        { status: 503, headers: { traceparent, "x-request-id": requestId } },
      );
      finish(503, "error");
      return unavailable;
    }
    // Provider callbacks authenticate with their raw-body signature. Keeping the
    // namespace outside AuthKit lets lanes add Stripe/e-sign routes without a
    // shared proxy edit; Hono still requires verifier-backed handlers.
    const isWebhook = request.nextUrl.pathname.startsWith("/api/v1/webhooks/");
    let response: NextResponse;
    if (releaseProof) {
      if (request.nextUrl.origin !== releaseProof.origin) {
        const denied = NextResponse.json(
          { title: "Release-proof origin is not authorized", status: 421 },
          { status: 421, headers: { traceparent, "x-request-id": requestId } },
        );
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
    response.headers.set("cache-control", "private, no-store");
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
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
