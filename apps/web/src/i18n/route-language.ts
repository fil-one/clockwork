import type { Locale } from "./locales";

/**
 * Staff routes render in English whatever language the reader saved; customer,
 * partner, demo and public routes render in the reader's language.
 *
 * Server components cannot see the URL, so `proxy.ts` tells them: it sets
 * this request header on every request it handles, replacing any value the
 * browser sent. The proxy does not see server actions, form posts or API
 * calls; for those the page that sent the request (its `Referer`) decides.
 * Either input can only choose between the reader's language and English.
 */
export const routeAudienceHeader = "x-clockwork-route-audience";

export type RouteAudience = "staff" | "reader";

/** `/internal` and everything below it: `app/(experience)/(internal)`. */
export function isStaffPath(pathname: string): boolean {
  return pathname === "/internal" || pathname.startsWith("/internal/");
}

export function routeAudience(pathname: string): RouteAudience {
  return isStaffPath(pathname) ? "staff" : "reader";
}

/** The language one request renders in, given the reader's saved language. */
export function routeLocale(
  readerLocale: Locale,
  headers: { get(name: string): string | null },
): Locale {
  const audience = headers.get(routeAudienceHeader);
  if (audience) return audience === "staff" ? "en" : readerLocale;
  const referer = headers.get("referer");
  if (!referer) return readerLocale;
  try {
    return isStaffPath(new URL(referer).pathname) ? "en" : readerLocale;
  } catch {
    return readerLocale;
  }
}
