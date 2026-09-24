import { documentLanguages, rtlLocales } from "@/src/i18n";
import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";
import { getLocale, getTranslations } from "@/src/i18n/server";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import "./globals.css";

import { brandFontVariables } from "./fonts";
import {
  demoJourneyView,
  demoPersonaCatalog,
  demoPersonaChoiceLabel,
  demoPersonaCookieName,
  demoPersonaSurfacesEnabled,
  resolveDemoPersona,
} from "@/src/auth/demo-persona";
import { WebVitals } from "@/src/features/performance/web-vitals";
import { parseTraceparent } from "@/src/features/performance/client-telemetry";
import { publicMetadataOrigin } from "@/src/features/shell/public-origin";
import { DemoPersonaSwitcher } from "@/src/features/shell/demo-persona-switcher";

const productName = "Fil One Commerce"; // i18n-exempt: product name, never translated

// Link unfurlers resolve the Open Graph image against the canonical public
// origin. Ordinary WorkOS deployments can derive the same origin from their
// callback; the standalone demo has no WorkOS settings and therefore uses its
// explicit canonical origin rather than leaking localhost into social cards.
const publicOrigin = publicMetadataOrigin(process.env);

// The icon, apple-icon, and opengraph-image files in this directory supply the
// link tags and og:image through the Next file convention. The description is
// in the reader's language; a link unfurler sends no language cookie and gets
// English.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  const description = t("demo.meta.description");
  return {
    metadataBase: new URL(publicOrigin),
    title: { default: productName, template: `%s · ${productName}` },
    description,
    applicationName: productName,
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: productName,
      title: productName,
      description,
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0090FF",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const t = await getTranslations();
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
      lang={documentLanguages[locale]}
      dir={rtlLocales.has(locale) ? "rtl" : "ltr"}
      data-scroll-behavior="smooth"
      className={brandFontVariables}
    >
      <body>
        <LanguageProvider locale={locale} catalog={catalogs[locale]}>
          {children}
          {persona ? (
            <DemoPersonaSwitcher
              personas={demoPersonaCatalog.map((choice) => ({
                value: choice.key,
                label: demoPersonaChoiceLabel(choice, t),
              }))}
              current={persona.key}
              personaName={persona.displayName}
              journey={demoJourneyView(persona.key, t)}
            />
          ) : null}
          <WebVitals {...(traceparent ? { traceparent } : {})} />
        </LanguageProvider>
      </body>
    </html>
  );
}
