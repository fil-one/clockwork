import type { Metadata } from "next";

import { BrandLogo } from "@clockwork/ui";

import { RegistrationForm } from "@/src/features/registration/registration-form";
import { brandAsset } from "@/src/features/shell/brand-assets";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("platform.registration.title") };
}

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations();
  const query = await searchParams;
  const registrationToken = first(
    query.code ?? query.registration_token ?? query.registrationToken,
  );
  return (
    <main className="access-main">
      <section className="access-card registration-card">
        <BrandLogo
          className="signing-wordmark"
          src={brandAsset()}
          name={t("app.name")}
        />
        <p className="eyebrow">{t("platform.registration.eyebrow")}</p>
        <h1>{t("platform.registration.title")}</h1>
        <p>{t("platform.registration.intro")}</p>
        <RegistrationForm initialRegistrationToken={registrationToken} />
      </section>
    </main>
  );
}
