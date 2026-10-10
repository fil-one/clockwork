import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StateBanner } from "@clockwork/ui";

import styles from "@/src/features/internal-ops/handoff/handoff.module.css";
import { emailDomain } from "@/src/features/internal-ops/organizations/model";
import { OrganizationForm } from "@/src/features/internal-ops/organizations/organization-form";
import { loadOnboardingHandoff } from "@/src/features/internal-ops/organizations/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.organizations.form.title") };
}

async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const handoffId =
    typeof query.handoff === "string" && /^[0-9a-f-]{36}$/iu.test(query.handoff)
      ? query.handoff
      : undefined;
  const [t, loaded] = await Promise.all([
    getTranslations(),
    loadOnboardingHandoff(handoffId),
  ]);
  if (loaded.kind === "forbidden") notFound();
  if (loaded.kind !== "ready") throw new Error("ONBOARDING_UNAVAILABLE");
  const handoff = loaded.value;
  const ready =
    !handoff || (handoff.status === "in_progress" && !handoff.organizationId);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <h1>{t("operations.organizations.form.title")}</h1>
        <p>
          {handoff
            ? t("operations.organizations.form.fromHandoff", {
                name: handoff.counterpartyLegalName,
              })
            : t("operations.organizations.form.description")}
        </p>
      </header>
      {ready ? (
        <OrganizationForm
          defaults={{
            handoffRequestId: handoff?.id ?? null,
            legalName: handoff?.counterpartyLegalName ?? "",
            side:
              handoff?.requestedSide === "partner"
                ? "channel_partner"
                : "customer",
            billingName: handoff?.signerName ?? "",
            billingEmail: handoff?.signerEmail ?? "",
            domain: handoff ? emailDomain(handoff.signerEmail) : "",
          }}
        />
      ) : (
        <StateBanner
          tone="warning"
          title={t("operations.organizations.form.handoffClosed")}
        />
      )}
    </main>
  );
}

export default withStaffPermission("operations:write", Page);
