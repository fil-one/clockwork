import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isLocale,
  localeCookie,
  localeCookieOptions,
} from "@/src/i18n/locales";

/** A shareable sales link selects a language without changing demo access. */
export function demoLanguageHandoff(
  request: NextRequest,
  enabled: boolean,
): NextResponse | undefined {
  if (
    !enabled ||
    !["/demo", "/demo/persona"].includes(request.nextUrl.pathname)
  )
    return undefined;
  const language = request.nextUrl.searchParams.get("lang");
  if (!isLocale(language)) return undefined;
  const target = request.nextUrl.clone();
  target.searchParams.delete("lang");
  const response = NextResponse.redirect(target, {
    status: 302,
    headers: { "cache-control": "private, no-store" },
  });
  response.cookies.set(localeCookie, language, {
    ...localeCookieOptions,
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}
