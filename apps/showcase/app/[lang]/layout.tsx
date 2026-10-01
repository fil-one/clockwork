import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import { I18nProvider } from "../../components/i18n-provider";
import { getDictionary } from "../../lib/dictionaries";
import { isLocale, locales, translator } from "../../lib/i18n";
import "../globals.css";
const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  display: "swap",
  variable: "--font-inter",
  weight: "100 900",
});
const origin =
  process.env.SHOWCASE_URL ??
  process.env.URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3100");
export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = translator(await getDictionary(lang), lang);
  const title = t("sales.meta.title");
  const description = t("sales.see.how.fil.one.commerce.connects.d507b");
  return {
    metadataBase: new URL(origin),
    title: { default: title, template: "%s · Fil One Commerce" },
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Fil One Commerce",
      locale: lang,
      images: [
        {
          url: `/${lang}/opengraph-image`,
          width: 1200,
          height: 630,
          alt: t("sales.meta.imageAlt"),
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/${lang}/opengraph-image`],
    },
    robots: { index: false, follow: true },
  };
}
export const viewport: Viewport = { themeColor: "#f7f9fc" };
export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dictionary = await getDictionary(lang);
  const t = translator(dictionary, lang);
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"}>
      <body className={inter.variable}>
        <I18nProvider locale={lang} dictionary={dictionary}>
          <a href="#main" className="skip-link">
            {t("sales.skip")}
          </a>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
