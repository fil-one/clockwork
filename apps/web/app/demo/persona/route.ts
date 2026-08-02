import { NextResponse } from "next/server";

import { secureDemoRequest } from "@/src/auth/demo-deploy";
import {
  demoPersonaCookieLifetimeSeconds,
  demoPersonaCookieName,
  demoPersonaStartRoute,
  demoPersonaSurfacesEnabled,
  isDemoPersonaKey,
} from "@/src/auth/demo-persona";

/**
 * A relative Location keeps the redirect correct behind the deploy platform's
 * proxy, where the request URL origin and the public origin can differ.
 */
function found(location: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { location, "cache-control": "private, no-store" },
  });
}

export function GET(request: Request): NextResponse {
  if (!demoPersonaSurfacesEnabled(process.env))
    return new NextResponse(null, { status: 404 });
  const requested =
    new URL(request.url).searchParams.get("persona")?.trim() ?? "";
  if (!isDemoPersonaKey(requested)) return found("/demo");
  const response = found(demoPersonaStartRoute(requested));
  response.cookies.set(demoPersonaCookieName, requested, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureDemoRequest(request),
    path: "/",
    maxAge: demoPersonaCookieLifetimeSeconds,
  });
  return response;
}
