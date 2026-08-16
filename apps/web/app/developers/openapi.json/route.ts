import { apiReferenceDocument } from "@/src/features/developer-reference/api-reference";

/**
 * The machine-readable half of the reference.
 *
 * A caller that is not a browser gets the same document the page renders and
 * the same document `packages/api/src/generated/openapi.json` holds -- one
 * source, so a client generated from this URL and a client generated from the
 * committed artifact cannot disagree.
 *
 * `force-static` is deliberate and, unlike the pages beside it, it takes
 * effect: a route handler does not go through `app/layout.tsx`, so the
 * `headers()`/`cookies()` call that makes every page dynamic does not reach
 * here. The build output lists this route as static. The document is a pure
 * function of the built source, so serving it from the build removes any
 * chance of a request-time difference between what this returns and what the
 * page renders.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(`${JSON.stringify(apiReferenceDocument(), null, 2)}\n`, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
