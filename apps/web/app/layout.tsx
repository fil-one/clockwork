import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

import { WebVitals } from "@/src/features/performance/web-vitals";
import { parseTraceparent } from "@/src/features/performance/client-telemetry";

export const metadata: Metadata = {
  title: { default: "Fil One Commerce", template: "%s · Fil One Commerce" },
  description:
    "Agreements, services, billing, and partner commerce in one dependable chain.",
  applicationName: "Fil One Commerce",
  robots: { index: false, follow: false },
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
