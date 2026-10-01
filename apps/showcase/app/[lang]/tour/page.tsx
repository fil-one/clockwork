import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Header, Footer } from "../../../components/chrome";
import { Tour } from "../../../components/tour";
import { getDictionary } from "../../../lib/dictionaries";
import { isLocale, translator } from "../../../lib/i18n";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = translator(await getDictionary(lang), lang);
  return {
    title: t("sales.meta.tour"),
    description: t("sales.meta.tourDescription"),
    openGraph: {
      title: `${t("sales.meta.tour")} · Fil One Commerce`,
      description: t("sales.meta.tourDescription"),
      images: [`/${lang}/opengraph-image`],
    },
    twitter: {
      title: `${t("sales.meta.tour")} · Fil One Commerce`,
      description: t("sales.meta.tourDescription"),
      images: [`/${lang}/opengraph-image`],
    },
  };
}
export default async function TourPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = translator(await getDictionary(lang), lang);
  return (
    <>
      <Header />
      <main id="main" className="tour-main">
        <Suspense
          fallback={
            <div className="tour-loading container" role="status">
              {t("sales.tour.loading")}
            </div>
          }
        >
          <Tour />
        </Suspense>
        <noscript>
          <div className="no-script container">
            {t("sales.tour.javascript")}{" "}
            <a href={`/${lang}#capabilities`}>{t("sales.tour.readOverview")}</a>
          </div>
        </noscript>
      </main>
      <Footer />
    </>
  );
}
