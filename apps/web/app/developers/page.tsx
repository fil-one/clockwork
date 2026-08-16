import type { Metadata } from "next";

import { ApiReferencePage } from "@/src/features/developer-reference/reference-page";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "The Clockwork Commerce API reference, generated from the contract the application serves, with a plain statement of what is not yet available to an integrator.",
};

/**
 * The published reference. It takes no parameters and reads nothing.
 *
 * As with `/trust` it is server-rendered on demand rather than prerendered,
 * because `app/layout.tsx` awaits `headers()` and `cookies()`. The document it
 * renders is a pure function of the built source either way. The spec route
 * beside it IS static, because it does not go through the layout.
 *
 * PUBLIC, DELIBERATELY. `apps/web/proxy.ts` puts AuthKit in front of every path
 * outside its `unauthenticatedPaths` list, and both "/developers" and
 * "/developers/openapi.json" are now in it. An integrator evaluating this API
 * has no account yet, so a reference behind sign-in reaches nobody who needs
 * it. The two entries are separate because AuthKit matches a path exactly and
 * not by prefix; `reference-page.test.tsx` asserts each one.
 *
 * Nothing here reads a session or a request: the page renders the built
 * contract, so an anonymous reader and a signed-in one receive the same bytes.
 */
export default function Page() {
  return <ApiReferencePage specHref="/developers/openapi.json" />;
}
