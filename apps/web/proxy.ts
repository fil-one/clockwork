import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import type { NextFetchEvent, NextRequest } from "next/server";
import { NextResponse } from "next/server";

const workosConfigured = Boolean(
  process.env.WORKOS_API_KEY &&
  process.env.WORKOS_CLIENT_ID &&
  process.env.WORKOS_COOKIE_PASSWORD,
);
const workosProxy = workosConfigured
  ? authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: ["/auth/callback", "/sign-in"],
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
  if (!workosConfigured && process.env.NODE_ENV === "production")
    return NextResponse.json(
      { title: "Authentication is not configured", status: 503 },
      { status: 503 },
    );
  // Provider callbacks authenticate with their raw-body signature. Keeping the
  // namespace outside AuthKit lets lanes add Stripe/e-sign routes without a
  // shared proxy edit; Hono still requires verifier-backed handlers.
  const isWebhook = request.nextUrl.pathname.startsWith("/api/v1/webhooks/");
  const authResponse =
    workosProxy && !isWebhook ? await workosProxy(request, event) : undefined;
  const response =
    authResponse instanceof NextResponse
      ? authResponse
      : authResponse instanceof Response
        ? new NextResponse(authResponse.body, authResponse)
        : NextResponse.next();
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
