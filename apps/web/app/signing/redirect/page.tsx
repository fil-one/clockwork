import Link from "next/link";

import { BrandLogo } from "@clockwork/ui";

import { SigningExperience } from "@/src/features/signing/signing-experience";
import { t } from "@/src/i18n/en";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agreementId?: string }>;
}) {
  const agreementId = (await searchParams).agreementId?.trim();
  if (!agreementId && process.env.NODE_ENV === "production")
    return (
      <main className="access-main" id="main-content">
        <section className="access-card">
          <BrandLogo
            className="signing-wordmark"
            src="/brand/fo-wordmark-dark.png"
            name={t("app.name")}
          />
          <p className="eyebrow">{t("signing.eyebrow")}</p>
          <h1>{t("signing.choose.title")}</h1>
          <p>{t("signing.choose.description")}</p>
          <Link className="cw-button cw-button--primary" href="/agreements">
            {t("signing.agreements")}
          </Link>
        </section>
      </main>
    );
  return (
    <SigningExperience
      mode="redirect"
      {...(agreementId ? { agreementId } : {})}
    />
  );
}
