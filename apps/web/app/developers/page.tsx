import type { Metadata } from "next";

import { ApiReferencePage } from "@/src/features/developer-reference/reference-page";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("platform.developers.title"),
    description: t("platform.developers.meta.description"),
  };
}

/**
 * The published reference. It takes no parameters.
 *
 * As with `/trust` it is server-rendered on demand rather than prerendered,
 * because `app/layout.tsx` awaits `headers()` and `cookies()`, and the page
 * itself reads the interface-language cookie. For a given language the
 * document it renders is a pure function of the built source. The spec route
 * beside it IS static, because it does not go through the layout.
 *
 * PUBLIC, DELIBERATELY. `apps/web/proxy.ts` puts AuthKit in front of every path
 * outside its `unauthenticatedPaths` list, and both "/developers" and
 * "/developers/openapi.json" are now in it. An integrator evaluating this API
 * has no account yet, so a reference behind sign-in reaches nobody who needs
 * it. The two entries are separate because AuthKit matches a path exactly and
 * not by prefix; `reference-page.test.tsx` asserts each one.
 *
 * Nothing here reads a session or an account. The one request input is the
 * interface-language cookie, which chooses the language of the page's own
 * words; the contract it renders is the built one, so an anonymous reader and
 * a signed-in one who read the same language receive the same bytes.
 */
export default function Page() {
  return <ApiReferencePage specHref="/developers/openapi.json" />;
}
