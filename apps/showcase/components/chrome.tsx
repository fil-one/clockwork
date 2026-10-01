"use client";
import { useI18n } from "./i18n-provider";
import Image from "next/image";
import Link from "next/link";
import { LanguageSelector } from "./language-selector";
import { Arrow } from "./icons";
import { sandboxOrigin } from "../lib/content";

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
          <a
            href={href(`${sandboxOrigin}/demo`)}
            className="button button-small"
          >
            {t("sales.explore.the.full.operational.sandbox.7e481")}
            <Arrow diagonal />
          </a>
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
      </div>
      <div>
        <span>{t("sales.fictional.data.no.real.charges.or.b2e7c")}</span>
      </div>
    </footer>
  );
}
