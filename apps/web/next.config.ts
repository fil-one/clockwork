import { join } from "node:path";

import type { NextConfig } from "next";

// A container image serves the standalone server Next emits; the hosted targets
// do not. ADR 0001 deploys to Vercel and the demo runs through
// @netlify/plugin-nextjs, and both want the default output -- standalone would
// leave their adapters copying a server they never start. So the Dockerfile
// asks for it by environment rather than every build producing it.
const standalone = process.env.CLOCKWORK_NEXT_STANDALONE === "1";

const config: NextConfig = {
  // Next dev must not generate source files during clean release qualification.
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.CLOCKWORK_NEXT_DIST_DIR ?? ".next",
  // Absent rather than set to undefined: `exactOptionalPropertyTypes` is on, so
  // `output: undefined` is a different thing from no `output` and Next's type
  // rejects it.
  //
  // `outputFileTracingRoot` names the workspace root rather than leaving Next
  // to infer one. Inference reads the lockfiles it can find, and in a pnpm
  // monorepo it can settle on `apps/web`, which leaves every `packages/*`
  // dependency out of the traced tree and the standalone server unable to
  // resolve them at startup.
  ...(standalone
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: join(import.meta.dirname, "../.."),
      }
    : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    // Next externalizes this package by default. Bundle its complete runtime
    // closure so copied server externals never depend on pnpm's symlink layout.
    // `@react-pdf/renderer` used to sit here for the same reason; it cannot,
    // and `serverExternalPackages` below says why.
    "@aws-sdk/client-s3",
    "@clockwork/api",
    "@clockwork/contracts",
    "@clockwork/domain",
    "@clockwork/ui",
  ],
  /**
   * `@react-pdf/renderer` must stay out of the server bundle graph, and this
   * says so explicitly rather than relying on Next's default list.
   *
   * It was in `transpilePackages` above, added with the closure-bundling reason
   * the comment there still gives. The effect was that every document in the
   * product was unreachable: all nineteen artifact ids answered 503, dev and
   * production build alike, on
   *
   *   TypeError: Cannot read properties of undefined (reading 'S')
   *
   * thrown inside `@react-pdf/reconciler`. Route handlers and server components
   * compile under the `react-server` export condition. Bundling the renderer
   * put its `@react-pdf/reconciler` dependency in that same graph, so its
   * `import React from "react"` resolved to `react.react-server.js`, which does
   * not export `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`.
   * The reconciler read `ReactSharedInternals.S` off `undefined` and died. A
   * React reconciler needs the client build of React by construction, so no
   * amount of bundler configuration makes this one bundleable -- which is why
   * Next itself ships it in `server-external-packages.jsonc`.
   *
   * The deployment concern that put it in `transpilePackages` is met a
   * different way. Externalized packages are not copied by hand; Next traces
   * them, and the trace beside each server chunk names every file in the
   * closure by its real path under `node_modules/.pnpm/...`, not through the
   * workspace symlink. Naming the package here rather than inheriting Next's
   * default also means a future release dropping it from that list cannot
   * silently reintroduce the crash.
   */
  serverExternalPackages: ["@react-pdf/renderer"],
  typedRoutes: true,
  headers() {
    return Promise.resolve([
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          // Session and CSRF cookies ride the first request to an origin, so
          // the browser is told to refuse plain http for a year before there is
          // one to downgrade. `preload` is deliberately absent: submission is
          // effectively one-way and is a decision to take explicitly rather
          // than by reflex. Gated on the production runtime -- the same signal
          // proxy.ts uses for the `secure` cookie flag -- so a developer's
          // browser never pins a local http origin. Browsers ignore the header
          // on a plain-http response, which is what the release-proof localhost
          // origin serves, so that mode is unaffected either way.
          //
          // The Content-Security-Policy is NOT here: it carries a per-request
          // nonce and this block is static, so proxy.ts emits it.
          ...(process.env.NODE_ENV === "production"
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=31536000; includeSubDomains",
                },
              ]
            : []),
        ],
      },
    ]);
  },
};

export default config;
