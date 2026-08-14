import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

import { explicitDemoIdentityEnabled } from "@/src/auth/session";
import { requestId } from "@/src/features/experience-server/authorization";

const configured = () =>
  Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );

/** Required by AuthKit, including dashboard-initiated impersonation flows. */
export async function GET(request: Request) {
  if (!configured()) {
    if (process.env.NODE_ENV === "production" && !explicitDemoIdentityEnabled())
      return NextResponse.json(
        {
          type: "https://clockwork.test/problems/authentication-not-configured",
          title: "Authentication is not configured",
          status: 503,
          code: "AUTHENTICATION_NOT_CONFIGURED",
          requestId: requestId(request),
          retryable: true,
        },
        {
          status: 503,
          headers: {
            "content-type": "application/problem+json",
            "cache-control": "private, no-store",
            "x-content-type-options": "nosniff",
          },
        },
      );
    return NextResponse.redirect(new URL("/", request.url));
  }
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("returnTo") ?? "/";
  const organizationId = requestUrl.searchParams.get("organizationId");
  const signInUrl = await getSignInUrl({
    returnTo: returnTo.startsWith("/") ? returnTo : "/",
    ...(organizationId ? { organizationId } : {}),
  });
  return NextResponse.redirect(signInUrl);
}
