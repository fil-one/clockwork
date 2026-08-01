import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { releaseProofConfiguration } from "@/src/auth/release-proof";

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

export default async function proxy(
  request: NextRequest,
  event: NextFetchEvent,
) {
  const releaseProof = releaseProofConfiguration();
  if (
    !workosConfigured &&
    !releaseProof &&
    process.env.NODE_ENV === "production"
  )
    return NextResponse.json(
      { title: "Authentication is not configured", status: 503 },
      { status: 503 },
    );
  // Provider callbacks authenticate with their raw-body signature. Keeping the
  // namespace outside AuthKit lets lanes add Stripe/e-sign routes without a
  // shared proxy edit; Hono still requires verifier-backed handlers.
  const isWebhook = request.nextUrl.pathname.startsWith("/api/v1/webhooks/");
  let response: NextResponse;
  if (releaseProof) {
    if (request.nextUrl.origin !== releaseProof.origin)
      return NextResponse.json(
        { title: "Release-proof origin is not authorized", status: 421 },
        { status: 421 },
      );
    const trustedRequestHeaders = new Headers(request.headers);
    trustedRequestHeaders.delete("x-clockwork-proof-origin");
    trustedRequestHeaders.set("x-clockwork-proof-origin", releaseProof.origin);
    response = NextResponse.next({
      request: { headers: trustedRequestHeaders },
    });
  } else {
    const authResponse =
      workosProxy && !isWebhook ? await workosProxy(request, event) : undefined;
    response =
      authResponse instanceof NextResponse
        ? authResponse
        : authResponse instanceof Response
          ? new NextResponse(authResponse.body, authResponse)
          : NextResponse.next();
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
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
