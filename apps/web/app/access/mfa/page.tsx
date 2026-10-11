import { getTranslations } from "@/src/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo, buttonClassName } from "@clockwork/ui";

import { brandAsset } from "@/src/features/shell/brand-assets";
import { mfaReturnTo } from "./return-to";
import { MfaForm } from "./form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("session.mfa.action") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const t = await getTranslations();
  const { error, returnTo: requestedReturnTo } = await searchParams;
  const returnTo = mfaReturnTo(requestedReturnTo);
  return (
    <main className="access-main">
      <section className="access-card">
        <BrandLogo
          className="signing-wordmark"
          src={brandAsset()}
          name={t("app.name")}
        />
        {/* i18n-exempt: acronym kept in Latin script in every language (glossary) */}
        <p className="eyebrow">MFA</p>
        <h1>{t("session.mfa.title")}</h1>
        <p>{t("session.mfa.description")}</p>
        {process.env.WORKOS_CLIENT_ID ? (
          <MfaForm
            returnTo={returnTo}
            error={typeof error === "string" ? error : undefined}
          />
        ) : (
          <Link
            className={buttonClassName({ variant: "primary" })}
            href="/sign-in"
          >
            {t("session.mfa.action")}
          </Link>
        )}
      </section>
    </main>
  );
}
