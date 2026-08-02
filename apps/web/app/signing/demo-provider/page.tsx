import Link from "next/link";
import { notFound } from "next/navigation";

import { BrandLogo, Button, StatusBadge } from "@clockwork/ui";

import {
  demoExperienceEnabled,
  demoExperienceRepository,
} from "@/src/features/experience-server/demo-experience-repository";
import { t } from "@/src/i18n/en";

export const metadata = { title: "Demo signing" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (!demoExperienceEnabled()) notFound();
  const state = (await searchParams).state?.trim() ?? "";
  const ceremony = state
    ? await demoExperienceRepository().readDemoCeremony(state)
    : undefined;
  if (!ceremony)
    return (
      <main className="access-main" id="main-content">
        <section className="access-card">
          <BrandLogo
            className="signing-wordmark"
            src="/brand/fo-wordmark-dark.png"
            name={t("app.name")}
          />
          <p className="eyebrow">{t("signing.demo.eyebrow")}</p>
          <h1>{t("signing.demo.unavailable.title")}</h1>
          <p>{t("signing.demo.unavailable.description")}</p>
          <Link className="cw-button cw-button--primary" href="/agreements">
            {t("signing.agreements")}
          </Link>
        </section>
      </main>
    );
  return (
    <main className="signing-main" id="main-content">
      <header className="signing-header">
        <div className="signing-wordmark">
          <BrandLogo src="/brand/fo-wordmark-dark.png" name={t("app.name")} />
          <span>{t("signing.demo.eyebrow")}</span>
        </div>
        <StatusBadge
          tone={ceremony.state === "completed" ? "success" : "neutral"}
        >
          {ceremony.state === "completed"
            ? t("status.signed")
            : t("status.pending")}
        </StatusBadge>
      </header>
      <section className="signing-card">
        <p className="eyebrow">{t("signing.demo.eyebrow")}</p>
        <h1>{t("signing.demo.title")}</h1>
        <p>{t("signing.demo.description")}</p>
        <dl className="signing-summary">
          <div>
            <dt>{t("signing.demo.document")}</dt>
            <dd>{ceremony.documentId}</dd>
          </div>
          <div>
            <dt>{t("signing.demo.signer")}</dt>
            <dd>{ceremony.signerEmail}</dd>
          </div>
          <div>
            <dt>{t("signing.demo.envelope")}</dt>
            <dd>{ceremony.envelopeId}</dd>
          </div>
        </dl>
        <form action="/signing/demo-provider/complete" method="post">
          <input type="hidden" name="state" value={state} />
          <div className="signing-actions">
            <Button type="submit">{t("signing.demo.action")}</Button>
          </div>
        </form>
      </section>
    </main>
  );
}
