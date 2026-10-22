import type { Metadata, Route } from "next";
import Link from "next/link";

import { Breadcrumbs, PageHeader } from "@clockwork/ui";

import { loadSettings } from "@/src/features/internal-ops/hubspot/page-data";
import { HubSpotPageState } from "@/src/features/internal-ops/hubspot/page-state";
import { HubSpotSettings } from "@/src/features/internal-ops/hubspot/settings";
import styles from "@/src/features/internal-ops/hubspot/hubspot.module.css";
import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.hubspot.settings.title") };
}

/** The HubSpot connection, its audience and its scope: `staff:manage`. */
async function Page() {
  const [t, loaded] = await Promise.all([getTranslations(), loadSettings()]);
  if (loaded.kind !== "ready")
    return (
      <HubSpotPageState
        state={loaded}
        title={t("operations.hubspot.settings.title")}
      />
    );
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          {
            label: t("operations.hubspot.settings.owner"),
            href: "/internal/owner",
          },
          { label: t("operations.hubspot.settings.title") },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={t("operations.hubspot.settings.title")}
        description={t("operations.hubspot.settings.description")}
      />
      <HubSpotSettings
        portal={loaded.portal}
        portalError={loaded.portalError}
        active={loaded.active}
        latest={loaded.latest}
        catalog={loaded.catalog}
        staff={loaded.staff}
        canManage={loaded.canManage}
      />
    </main>
  );
}

export default withStaffPermission("staff:manage", Page);
