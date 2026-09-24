import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo, buttonClassName } from "@clockwork/ui";

import { brandAsset } from "@/src/features/shell/brand-assets";
import { SigningExperience } from "@/src/features/signing/signing-experience";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("signing.embedded") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ agreementId?: string }>;
}) {
  const t = await getTranslations();
  const agreementId = (await searchParams).agreementId?.trim();
  if (!agreementId && process.env.NODE_ENV === "production")
    return (
      <main className="access-main" id="main-content">
        <section className="access-card">
          <BrandLogo
            className="signing-wordmark"
            src={brandAsset()}
            name={t("app.name")}
          />
          <p className="eyebrow">{t("signing.eyebrow")}</p>
          <h1>{t("signing.choose.title")}</h1>
          <p>{t("signing.choose.description")}</p>
          <Link
            className={buttonClassName({ variant: "primary" })}
            href="/agreements"
          >
            {t("signing.agreements")}
          </Link>
        </section>
      </main>
    );
  return (
    <SigningExperience
      mode="embedded"
      {...(agreementId ? { agreementId } : {})}
    />
  );
}
