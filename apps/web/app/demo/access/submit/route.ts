import { NextResponse } from "next/server";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  demoAccessLifetimeSeconds,
  demoAccessRoute,
  equalDemoSecret,
  issueDemoAccessCookie,
  safeDemoReturnPath,
} from "@/src/auth/demo-access";
import { secureDemoRequest } from "@/src/auth/demo-deploy";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * A relative Location keeps the redirect correct behind the deploy platform's
 * proxy, where the request URL origin and the public origin can differ.
 */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location, "cache-control": "private, no-store" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const password = demoAccessConfiguration(process.env);
  if (!password) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (
    !origin ||
    !host ||
    !URL.canParse(origin) ||
    new URL(origin).host !== host
  )
    return new NextResponse(null, { status: 403 });
  const form = await request.formData();
  const next = safeDemoReturnPath(field(form, "next"));
  if (!(await equalDemoSecret(field(form, "password"), password)))
    return seeOther(
      `${demoAccessRoute}?error=1&next=${encodeURIComponent(next)}`,
    );
  const grant = await issueDemoAccessCookie(password);
  const response = seeOther(next);
  response.cookies.set(demoAccessCookieName, grant.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureDemoRequest(request),
    path: "/",
    maxAge: demoAccessLifetimeSeconds,
  });
  return response;
}
