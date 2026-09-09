import { getTranslations } from "@/src/i18n/server";
import { use } from "react";
import Link from "next/link";

import { BrandLogo, buttonClassName } from "@clockwork/ui";

import { brandAsset } from "@/src/features/shell/brand-assets";

export default function Page() {
  const t = use(getTranslations());
  return (
    <main className="access-main">
      <section className="access-card">
        <BrandLogo
          className="signing-wordmark"
          src={brandAsset()}
          name={t("app.name")}
        />
        <p className="eyebrow">401</p>
        <h1>{t("session.expired.title")}</h1>
        <p>{t("session.expired.description")}</p>
        <Link
          className={buttonClassName({ variant: "primary" })}
          href="/sign-in"
        >
          {t("session.expired.action")}
        </Link>
      </section>
    </main>
  );
}
