import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

import { WebVitals } from "@/src/features/performance/web-vitals";
import { parseTraceparent } from "@/src/features/performance/client-telemetry";

const description =
  "Agreements, services, billing, and partner commerce in one dependable chain.";

// Link unfurlers resolve the Open Graph image against this origin. The AuthKit
// redirect URI is already the deployed public origin, so no second setting is
// introduced; a malformed value falls back to the local development origin.
const publicOrigin =
  /^https?:\/\/[^/]+/.exec(process.env.WORKOS_REDIRECT_URI ?? "")?.[0] ??
  "http://localhost:3000";

// The icon, apple-icon, and opengraph-image files in this directory supply the
// link tags and og:image through the Next file convention.
export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: { default: "Fil One Commerce", template: "%s · Fil One Commerce" },
  description,
  applicationName: "Fil One Commerce",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "Fil One Commerce",
    title: "Fil One Commerce",
    description,
  },
};

export const viewport: Viewport = {
  themeColor: "#0090FF",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const incomingTrace = parseTraceparent(
    (await headers()).get("traceparent") ?? undefined,
  );
  const traceparent = incomingTrace
    ? `00-${incomingTrace.traceId}-${incomingTrace.spanId}-${incomingTrace.traceFlags}`
    : undefined;
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {children}
        <WebVitals {...(traceparent ? { traceparent } : {})} />
      </body>
    </html>
  );
}
