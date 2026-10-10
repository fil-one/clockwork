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
  return { title: t("operations.partners.form.newTitle") };
}

/** A new partner record: `contract:write`. */
async function Page() {
  const [t, loaded] = await Promise.all([getTranslations(), loadPartnerForm()]);
  if (loaded.kind !== "ready")
    return (
      <PartnerPageState
        state={loaded}
        title={t("operations.partners.form.newTitle")}
      />
    );
  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.partners.form.newTitle")}
        description={t("operations.partners.form.newDescription")}
      />
      <PartnerForm
        partner={null}
        owners={loaded.owners}
        organizations={loaded.organizations}
        viewer={loaded.viewer}
      />
    </main>
  );
}

export default withStaffPermission("contract:write", Page);
