import type { Metadata } from "next";

import { getTranslations } from "@/src/i18n/server";
import { ReportsView } from "@/src/features/internal-ops/finance-lifecycle/reports-view";
import { loadReportsWorkspace } from "@/src/features/internal-ops/finance-lifecycle/server-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.finance.reports.title") };
}

export default async function Page() {
  const workspace = await loadReportsWorkspace();
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <ReportsView
        exports={workspace.items}
        accounts={workspace.accounts}
        provenance={workspace.provenance}
      />
    </SurfacePermissionGate>
  );
}
