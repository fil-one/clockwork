import type { Metadata } from "next";

import { PageHeader } from "@clockwork/ui";

import { PartnerForm } from "@/src/features/internal-ops/partners/partner-form";
import { PartnerPageState } from "@/src/features/internal-ops/partners/page-state";
import { loadPartnerForm } from "@/src/features/internal-ops/partners/server";
import styles from "@/src/features/internal-ops/partners/partners.module.css";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.partners.detail.edit") };
}

/** Editing a partner's record and terms: `contract:write`. */
async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, loaded] = await Promise.all([
    getTranslations(),
    loadPartnerForm(id),
  ]);
  if (loaded.kind !== "ready" || !loaded.partner)
    return (
      <PartnerPageState
        state={loaded.kind === "ready" ? { kind: "missing" } : loaded}
        title={t("operations.partners.detail.edit")}
      />
    );
  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.partners.form.editTitle", {
          name: loaded.partner.name,
        })}
      />
      <PartnerForm
        partner={loaded.partner}
        owners={loaded.owners}
        organizations={loaded.organizations}
        viewer={loaded.viewer}
      />
    </main>
  );
}

export default withStaffPermission("contract:write", Page);
