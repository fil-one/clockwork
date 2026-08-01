import Link from "next/link";

import { BrandLogo } from "@clockwork/ui";

import { t } from "@/src/i18n/en";
export default function Page() {
  return (
    <main className="access-main">
      <section className="access-card">
        <BrandLogo
          className="signing-wordmark"
          src="/brand/fo-wordmark-dark.png"
          name={t("app.name")}
        />
        <p className="eyebrow">401</p>
        <h1>{t("session.expired.title")}</h1>
        <p>{t("session.expired.description")}</p>
        <Link className="cw-button cw-button--primary" href="/sign-in">
          {t("session.expired.action")}
        </Link>
      </section>
    </main>
  );
}
