import type { Metadata } from "next";

import { TrustPage } from "@/src/features/trust/trust-page";

export const metadata: Metadata = {
  title: "Security, privacy and compliance",
  description:
    "The security, privacy and compliance controls this system implements, each one citing the source that shows it, and a plain statement of what is not claimed.",
};

/**
 * Enterprise security review starts before first contact, so this route holds
 * no session, reads no database and takes no parameters. It is a pure render of
 * `trust-register.ts`.
 *
 * IT IS STILL SERVER-RENDERED ON DEMAND. `app/layout.tsx` awaits `headers()`
 * and `cookies()`, which opts every route in this application out of static
 * generation -- the build output lists this route as dynamic. Nothing here
 * depends on that either way; it is written down because the obvious assumption
 * is the wrong one and the first draft of this file made it.
 *
 * PUBLIC, DELIBERATELY. `apps/web/proxy.ts` runs AuthKit in front of every path
 * that is not in its `unauthenticatedPaths` list, and "/trust" is now in that
 * list. It has to be: an enterprise security review starts before first
 * contact, and a trust page a prospect has to sign in to read is not one.
 *
 * WHY THAT IS SAFE HERE AND WOULD NOT BE ELSEWHERE. AuthKit's matcher is exact
 * -- the entry admits `/trust` and nothing under it -- and this component takes
 * no props, reads no session, cookie or header, and renders module constants,
 * so the bytes an anonymous reader receives are the bytes every reader
 * receives. `trust-page.test.tsx` asserts both halves: that the proxy entry is
 * present, and that two renders are identical and carry no address, identifier
 * or token.
 */
export default function Page() {
  return <TrustPage />;
}
