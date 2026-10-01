"use client";
import { useI18n } from "./i18n-provider";
import Image from "next/image";
import Link from "next/link";
import { LanguageSelector } from "./language-selector";
import { Arrow } from "./icons";

export function Header() {
  const { t, href } = useI18n();
  return (
    <header className="site-header">
      <div className="nav-inner container">
        <Link
          href={href("/")}
          className="brand"
          aria-label={t("sales.fil.one.commerce.home.2e131")}
        >
          <Image
            src="/brand/fo-wordmark-dark.png"
            alt="Fil One"
            width={112}
            height={32}
            priority
          />
          <span>Commerce</span>
        </Link>
        <LanguageSelector />
        <nav aria-label={t("sales.main.navigation.eb355")}>
          <a href={href("/#capabilities")}>{t("sales.capabilities.9460f")}</a>
          <a href={href("/#connected")}>{t("sales.what.s.next.e795b")}</a>
          <Link href={href("/tour")} className="button button-small">
            {t("sales.take.the.tour.a83c4")}
            <Arrow />
          </Link>
        </nav>
      </div>
    </header>
  );
}
export function Footer() {
  const { t, href } = useI18n();
  return (
    <footer className="site-footer container">
      <div>
        <Link href={href("/")} className="footer-brand">
          Fil One <span>Commerce</span>
        </Link>
        <p>{t("sales.a.connected.commercial.workflow.for.fil.8cc4b")}</p>
      </div>
      <div>
        <span>{t("sales.fictional.data.no.real.charges.or.b2e7c")}</span>
      </div>
    </footer>
  );
}
