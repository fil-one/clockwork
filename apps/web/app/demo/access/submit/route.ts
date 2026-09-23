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
import { isLocale, localeCookie, localeCookieOptions } from "@/src/i18n";

/**
 * The body is read as text and parsed here rather than through `formData()`.
 * The deploy platform's Next runtime does not deliver a parsed form to a route
 * handler behind middleware: a urlencoded body arrives with no fields and a
 * multipart body throws. Reading the raw text works on both runtimes and keeps
 * the handler independent of the adapter.
 */
async function submittedFields(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text());
}

function field(form: URLSearchParams, name: string): string {
  return form.get(name) ?? "";
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

/**
 * The language chosen at the gate travels with the password, so it holds
 * whether or not the selector's own save reached the server first. It is set on
 * a refusal too: the retry should read in the language the visitor picked.
 */
function carryLanguage(
  response: NextResponse,
  form: URLSearchParams,
  request: Request,
): NextResponse {
  const language = form.get("language");
  if (isLocale(language))
    response.cookies.set(localeCookie, language, {
      ...localeCookieOptions,
      secure: secureDemoRequest(request),
    });
  return response;
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
  const form = await submittedFields(request);
  const next = safeDemoReturnPath(field(form, "next"));
  if (!(await equalDemoSecret(field(form, "password"), password)))
    return carryLanguage(
      seeOther(`${demoAccessRoute}?error=1&next=${encodeURIComponent(next)}`),
      form,
      request,
    );
  const grant = await issueDemoAccessCookie(password);
  const response = carryLanguage(seeOther(next), form, request);
  response.cookies.set(demoAccessCookieName, grant.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureDemoRequest(request),
    path: "/",
    maxAge: demoAccessLifetimeSeconds,
  });
  return response;
}
