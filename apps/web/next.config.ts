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
        ],
      },
    ]);
  },
};

export default config;
