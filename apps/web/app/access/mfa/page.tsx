import Link from "next/link";

import { BrandLogo, Button, Input, buttonClassName } from "@clockwork/ui";

import { brandAsset } from "@/src/features/shell/brand-assets";
import { t } from "@/src/i18n/en";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="access-main">
      <section className="access-card">
        <BrandLogo
          className="signing-wordmark"
          src={brandAsset()}
          name={t("app.name")}
        />
        <p className="eyebrow">MFA</p>
        <h1>{t("session.mfa.title")}</h1>
        <p>{t("session.mfa.description")}</p>
        {process.env.WORKOS_CLIENT_ID ? (
          <form
            className="access-form"
            action="/access/mfa/verify"
            method="post"
          >
            <p>
              Confirm your authenticator code to unlock this Clockwork session.
            </p>
            {error && (
              <p role="alert">
                {error === "limited"
                  ? "Too many attempts. Wait ten minutes before trying again."
                  : error === "invalid"
                    ? "That code was not accepted. Enter the current code from your authenticator."
                    : "Verification is unavailable. Try again shortly or sign in again."}
              </p>
            )}
            <Input
              label="Authenticator code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
            <Button type="submit">Verify and continue</Button>
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
