import type { NextConfig } from "next";

const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  distDir: process.env.CLOCKWORK_NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    // Next externalizes these packages by default. Bundle their complete runtime
    // closures so copied server externals never depend on pnpm's symlink layout.
    "@aws-sdk/client-s3",
    "@react-pdf/renderer",
    "@clockwork/api",
    "@clockwork/contracts",
    "@clockwork/domain",
    "@clockwork/ui",
  ],
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
