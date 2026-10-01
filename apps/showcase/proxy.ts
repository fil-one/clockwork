import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocale, preferredLocale } from "./lib/i18n";
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const first = path.split("/")[1] ?? "";
  if (isLocale(first)) {
    const response = NextResponse.next();
    // Explicit shareable language paths take priority over remembered preference.
    response.cookies.set("fil-one-commerce-language", first, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 31536000,
    });
    return response;
  }
  const locale = preferredLocale(
    request.cookies.get("fil-one-commerce-language")?.value,
    request.headers.get("accept-language"),
  );
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${path === "/" ? "" : path}`;
  const response = NextResponse.redirect(url);
  response.headers.set("Vary", "Accept-Language, Cookie");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next|brand/|favicon.ico|icon.png|.*\\.[a-zA-Z0-9]+$).*)"],
};
