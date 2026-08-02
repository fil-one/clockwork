import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

import { brandFontVariables } from "./fonts";
import {
  demoJourneyForPersona,
  demoPersonaCatalog,
  demoPersonaCookieName,
  demoPersonaSurfacesEnabled,
  resolveDemoPersona,
} from "@/src/auth/demo-persona";
import { WebVitals } from "@/src/features/performance/web-vitals";
import { parseTraceparent } from "@/src/features/performance/client-telemetry";
import {
  DemoPersonaSwitcher,
  type DemoJourneyView,
} from "@/src/features/shell/demo-persona-switcher";
import type { DemoPersonaKey } from "@clockwork/testing/personas";

function demoJourneyView(persona: DemoPersonaKey): DemoJourneyView | undefined {
  const journey = demoJourneyForPersona(persona);
  return journey
    ? {
        title: journey.title,
        steps: journey.steps.map(({ route, intent }) => ({ route, intent })),
      }
    : undefined;
}

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
  // The presenter panel appears only once a demo deploy has a chosen persona.
  // Off a demo deploy the cookie is never read and nothing is rendered.
  const persona = demoPersonaSurfacesEnabled(process.env)
    ? resolveDemoPersona({
        cookie: (await cookies()).get(demoPersonaCookieName)?.value,
      })
    : undefined;
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={brandFontVariables}
    >
      <body>
        {children}
        {persona ? (
          <DemoPersonaSwitcher
            personas={demoPersonaCatalog.map(
              ({ key, displayName, jobTitle }) => ({
                value: key,
                label: `${displayName} · ${jobTitle}`,
              }),
            )}
            current={persona.key}
            personaName={persona.displayName}
            journey={demoJourneyView(persona.key)}
          />
        ) : null}
        <WebVitals {...(traceparent ? { traceparent } : {})} />
      </body>
    </html>
  );
}
