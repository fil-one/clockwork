import type { Metadata } from "next";

import { TrustPage } from "@/src/features/trust/trust-page";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return {
    title: t("platform.trust.title"),
    description: t("platform.trust.metaDescription"),
  };
}

/**
 * Enterprise security review starts before first contact, so this route holds
 * no session, reads no database and takes no parameters. It is a pure render of
 * `trust-register.ts` in the reader's interface language.
 *
 * IT IS STILL SERVER-RENDERED ON DEMAND. `app/layout.tsx` awaits `headers()`
 * and `cookies()`, which opts every route in this application out of static
 * generation -- the build output lists this route as dynamic. The page itself
 * now needs that too: it reads the language preference cookie to choose which
 * language to render. It is written down because the obvious assumption is the
 * wrong one and the first draft of this file made it.
 *
 * PUBLIC, DELIBERATELY. `apps/web/proxy.ts` runs AuthKit in front of every path
 * that is not in its `unauthenticatedPaths` list, and "/trust" is now in that
 * list. It has to be: an enterprise security review starts before first
 * contact, and a trust page a prospect has to sign in to read is not one.
 *
 * WHY THAT IS SAFE HERE AND WOULD NOT BE ELSEWHERE. AuthKit's matcher is exact
 * -- the entry admits `/trust` and nothing under it -- and this component takes
 * no props, reads no session or header, and renders module constants. The one
 * request input is the interface-language preference cookie, which selects the
 * language of the same messages, so the bytes an anonymous reader receives are
 * the bytes every reader in that language receives. `trust-page.test.tsx`
 * asserts both halves: that the proxy entry is present, and that two renders
 * are identical and carry no address, identifier or token.
 */
export default function Page() {
  return <TrustPage />;
}
