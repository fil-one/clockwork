import { createElement, type ReactElement } from "react";
import { NextRequest } from "next/server";
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";
import { getLayerAssets } from "next/dist/server/app-render/get-layer-assets";
import { createComponentStylesAndScripts } from "next/dist/server/app-render/create-component-styles-and-scripts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workos-inc/authkit-nextjs", () => ({
  authkitMiddleware: vi.fn(() => vi.fn()),
}));

/**
 * The document is only as protected as its least-nonced script tag.
 *
 * `proxy.ts` serves `script-src 'self' 'nonce-...' 'strict-dynamic'` in
 * production. Under 'strict-dynamic' a host-source allowance like 'self' is
 * ignored for parser-inserted scripts, so a `<script src>` in the served HTML
 * either carries this request's nonce or the browser refuses it outright. There
 * is no partial credit and no fallback: the chunk simply never runs, and
 * because Turbopack's chunk loader reuses an already-present script element
 * rather than inserting its own (`static/chunks/turbopack-*.js`: if
 * `document.querySelectorAll('script[src=...]')` finds one it only attaches an
 * `error` listener), the refused element also poisons the runtime's recovery
 * path -- the listener is attached after the refusal has already fired, so the
 * chunk's load promise never settles. A component riding a refused chunk does
 * not error, it hangs. No boundary catches it and nothing renders.
 *
 * That makes "every script tag carries the nonce" a property worth asserting
 * structurally rather than by eyeballing one page's HTML. The document's
 * script tags come from three places, and this file covers all three:
 *
 *  1. React's bootstrap and Flight scripts, nonced by the renderer from
 *     `ctx.nonce`, which Next parses out of the `content-security-policy`
 *     REQUEST header that `proxy.ts` forwards. `readsTheNonce` below asserts
 *     that parse still succeeds against Next's own parser.
 *  2. Per-segment assets for a `layout.tsx`/`page.tsx`, built by
 *     `getLayerAssets`.
 *  3. Per-segment assets for the route conventions -- `template.tsx`,
 *     `error.tsx`, `loading.tsx`, `not-found.tsx`, `forbidden.tsx`,
 *     `unauthorized.tsx` -- built by `createComponentStylesAndScripts`.
 *
 * (2) and (3) are the same job done twice in Next, and only (2) passes the
 * nonce. That is the defect this file exists for. It is not hypothetical and
 * it is not confined to one control: any client module that a route convention
 * pulls in and an ancestor layout does not already carry gets its own chunk,
 * and that chunk ships un-nonced on every route where no layout or page at the
 * same segment claimed it first. Today that is exactly one 321-byte chunk
 * (`RefreshProjection`) on nine customer detail routes. Tomorrow it is whatever
 * the next lane adds to a collection's `loading.tsx` graph.
 *
 * These tests drive Next's real builders instead of reading their source, so
 * an upgrade that renames a file fails at import and an upgrade that fixes or
 * re-breaks the nonce fails or passes on behaviour.
 */

const MANIFESTS_SINGLETON = Symbol.for("next.server.manifests");
const NONCE = "test-nonce-value";
const SEGMENT = "app/(experience)/(customer)/quotes/loading";
const CHUNK = "static/chunks/segment-only-client-module.js";

/**
 * The one input both builders read: the client reference manifest, through
 * `getLinkAndScriptTags`. One entry, one JS chunk, no CSS -- enough for the
 * builder to have something to emit and nothing else to go wrong on.
 */
function withClientReferenceManifest(): () => void {
  const globals = globalThis as Record<symbol, unknown>;
  const previous = globals[MANIFESTS_SINGLETON];
  globals[MANIFESTS_SINGLETON] = {
    proxiedClientReferenceManifest: {
      entryCSSFiles: {},
      entryJSFiles: { [SEGMENT]: [CHUNK] },
    },
  };
  return () => {
    if (previous === undefined) delete globals[MANIFESTS_SINGLETON];
    else globals[MANIFESTS_SINGLETON] = previous;
  };
}

function renderContext() {
  return {
    assetPrefix: "",
    nonce: NONCE,
    componentMod: { createElement },
    renderOpts: { crossOrigin: undefined, nextFontManifest: undefined },
    sharedContext: {},
    parsedRequestHeaders: { isRSCRequest: false },
  };
}

/** Every `<script>` element in a builder's return value. */
function scriptElements(assets: unknown): ReactElement[] {
  const flat = Array.isArray(assets) ? assets.flat(Infinity) : [assets];
  return flat.filter(
    (node): node is ReactElement =>
      Boolean(node) &&
      typeof node === "object" &&
      (node as ReactElement).type === "script",
  );
}

describe("script tags the renderer emits carry the request nonce", () => {
  let restoreManifest: () => void;

  beforeEach(() => {
    restoreManifest = withClientReferenceManifest();
  });

  afterEach(() => {
    restoreManifest();
  });

  it("nonces the assets of a layout or page segment", () => {
    const assets = getLayerAssets({
      ctx: renderContext() as never,
      layoutOrPagePath: `${SEGMENT}.tsx`,
      injectedCSS: new Set<string>(),
      injectedJS: new Set<string>(),
      injectedFontPreloadTags: new Set<string>(),
      preloadCallbacks: [],
    });

    const scripts = scriptElements(assets);
    // The harness has to be emitting something for the assertion below to
    // mean anything. If Next stops routing segment chunks through script
    // elements this fails here rather than passing vacuously.
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.props).toMatchObject({ src: `/_next/${CHUNK}` });
    expect(scripts[0]?.props).toMatchObject({ nonce: NONCE });
  });

  /**
   * The failing half.
   *
   * `loading.tsx` is the sharp case because `LoadingBoundary` renders its
   * scripts as the Suspense FALLBACK
   * (`next/dist/esm/client/components/layout-router.js`), so they are flushed
   * into the initial HTML on every route that suspends -- unlike the error and
   * template conventions, whose scripts only render if the boundary does. But
   * the omission is in the shared builder, so all six conventions carry it and
   * the assertion is written against the builder rather than against `loading`.
   */
  it("nonces the assets of a route convention segment", async () => {
    const [, , scripts] = await createComponentStylesAndScripts({
      ctx: renderContext() as never,
      filePath: `${SEGMENT}.tsx`,
      getComponent: () => Promise.resolve({ default: () => null }),
      injectedCSS: new Set<string>(),
      injectedJS: new Set<string>(),
    });

    const emitted = scriptElements(scripts);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.props).toMatchObject({ src: `/_next/${CHUNK}` });
    expect(emitted[0]?.props).toMatchObject({ nonce: NONCE });
  });
});

describe("the renderer can read the nonce the proxy forwards", () => {
  /**
   * `ctx.nonce` -- the value both builders above stamp -- is not configured
   * anywhere. Next parses it out of the `content-security-policy` request
   * header `proxy.ts` sets on the forwarded request. A policy this parser
   * cannot read does not fail loudly; it produces `ctx.nonce === undefined`
   * and every script on every page silently loses its nonce, which under
   * 'strict-dynamic' means every page stops working. Next's own parser is
   * imported rather than reimplemented so that a change to the accepted nonce
   * alphabet is caught here instead of in production.
   */
  it("parses the same nonce out of the forwarded policy that it forwards as x-nonce", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
    const { default: proxy } = await import("../proxy");

    const pending: Promise<unknown>[] = [];
    const response = await proxy(
      new NextRequest("http://localhost:3000/quotes/quote-1", {
        headers: { "sec-fetch-dest": "document" },
      }),
      {
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise);
        },
      } as never,
    );
    await Promise.all(pending);

    const forwarded = response.headers.get(
      "x-middleware-request-content-security-policy",
    );
    expect(forwarded).toBeTruthy();
    const nonce = getScriptNonceFromHeader(forwarded ?? "");
    expect(nonce).toBeTruthy();
    expect(nonce).toBe(response.headers.get("x-middleware-request-x-nonce"));
    // The response policy the browser enforces has to name the same nonce the
    // renderer was handed, or the two disagree and every script is refused.
    expect(response.headers.get("content-security-policy")).toContain(
      `'nonce-${nonce}'`,
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
