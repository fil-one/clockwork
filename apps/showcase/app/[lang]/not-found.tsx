"use client";
import { useI18n } from "../../components/i18n-provider";
import Link from "next/link";
import { Header, Footer } from "../../components/chrome";
export default function NotFound() {
  const { t, href } = useI18n();
  return (
    <>
      <Header />
      <main id="main" className="section container">
        <p className="eyebrow">{t("sales.page.not.found.80445")}</p>
        <h1>{t("sales.this.link.has.taken.a.detour.7b896")}</h1>
        <p className="not-found-copy">
          {t("sales.the.fil.one.commerce.overview.and.6ccc6")}
        </p>
        <Link href={href("/")} className="button">
          {t("sales.back.to.the.overview.db3c6")}
        </Link>
      </main>
      <Footer />
    </>
  );
}
