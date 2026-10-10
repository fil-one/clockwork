import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Breadcrumbs, PageHeader, StateBanner } from "@clockwork/ui";

import pageStyles from "@/src/features/internal-ops/contracts/contracts.module.css";
import { emailDomain } from "@/src/features/internal-ops/organizations/model";
import { OrganizationForm } from "@/src/features/internal-ops/organizations/organization-form";
import { OrganizationPageState } from "@/src/features/internal-ops/organizations/organization-views";
import { loadOnboardingHandoff } from "@/src/features/internal-ops/organizations/server";
import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
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
  if (loaded.kind !== "ready")
    return (
      <OrganizationPageState
        heading="operations.organizations.form.title"
        state={loaded.kind}
        unavailable="operations.organizations.form.unavailable"
      />
    );
  const handoff = loaded.value;
  const ready =
    !handoff || (handoff.status === "in_progress" && !handoff.organizationId);
  return (
    <main className={pageStyles.page} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          {
            label: t("operations.organizations.title"),
            href: "/internal/organizations",
          },
          { label: t("operations.organizations.form.title") },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={t("operations.organizations.form.title")}
        description={
          handoff
            ? t("operations.organizations.form.fromHandoff", {
                name: handoff.counterpartyLegalName,
              })
            : t("operations.organizations.form.description")
        }
      />
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
