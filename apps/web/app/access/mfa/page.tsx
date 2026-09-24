import { getTranslations } from "@/src/i18n/server";
import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo, Button, Input, buttonClassName } from "@clockwork/ui";

import { brandAsset } from "@/src/features/shell/brand-assets";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("session.mfa.action") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations();
  const { error } = await searchParams;
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
          <form
            className="access-form"
            action="/access/mfa/verify"
            method="post"
          >
            <p>{t("platform.mfa.prompt")}</p>
            {error && (
              <p role="alert">
                {t(
                  error === "limited"
                    ? "platform.mfa.error.limited"
                    : error === "invalid"
                      ? "platform.mfa.error.invalid"
                      : "platform.mfa.error.unavailable",
                )}
              </p>
            )}
            <Input
              label={t("platform.mfa.code")}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
            <Button type="submit">{t("platform.mfa.submit")}</Button>
            <Link href="/sign-in">{t("session.expired.action")}</Link>
          </form>
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
