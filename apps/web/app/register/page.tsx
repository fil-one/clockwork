import { BrandLogo } from "@clockwork/ui";

import { RegistrationForm } from "@/src/features/registration/registration-form";
import { t } from "@/src/i18n/en";

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function RegistrationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const registrationToken = first(
    query.code ?? query.registration_token ?? query.registrationToken,
  );
  return (
    <main className="access-main">
      <section className="access-card registration-card">
        <BrandLogo
          className="signing-wordmark"
          src="/brand/fo-wordmark-dark.png"
          name={t("app.name")}
        />
        <p className="eyebrow">Organization registration</p>
        <h1>Start with a verified business identity.</h1>
        <p>
          Register the legal entity, billing contacts, and business domain. The
          server exchanges the one-time WorkOS code and rejects email/domain
          mismatches before creating an account.
        </p>
        <RegistrationForm initialRegistrationToken={registrationToken} />
      </section>
    </main>
  );
}
