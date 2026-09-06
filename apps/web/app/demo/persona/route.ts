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
 * See Other also avoids Netlify's 302 query passthrough retaining the persona
 * selector on the destination page; the HttpOnly cookie carries the selection.
 */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location, "cache-control": "private, no-store" },
  });
}

export function GET(request: Request): NextResponse {
  if (!demoPersonaSurfacesEnabled(process.env))
    return new NextResponse(null, { status: 404 });
  const requested =
    new URL(request.url).searchParams.get("persona")?.trim() ?? "";
  if (!isDemoPersonaKey(requested)) return seeOther("/demo");
  const response = seeOther(demoPersonaStartRoute(requested));
  response.cookies.set(demoPersonaCookieName, requested, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureDemoRequest(request),
    path: "/",
    maxAge: demoPersonaCookieLifetimeSeconds,
  });
  return response;
}
