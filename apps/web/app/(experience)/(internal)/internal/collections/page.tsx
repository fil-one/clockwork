import type { Metadata } from "next";

import { BillingOffNotice } from "@/src/features/internal-ops/billing-off-notice";

import { getTranslations } from "@/src/i18n/server";
import { CollectionsView } from "@/src/features/internal-ops/finance-lifecycle/collections-view";
import { loadCollectionsWorkspace } from "@/src/features/internal-ops/finance-lifecycle/server-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRoutePermissions } from "@/src/features/shell/route-session";
import { withStaffPermission } from "@/src/features/shell/staff-access";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.finance.collections.title") };
}

/**
 * Reading the queue needs `billing:read`, which every internal role holds.
 * Raising a correction needs `billing:approve`, which only a finance approver
 * holds, and the gate on each action enforces that separately. Requiring the
 * approval permission to open the page denied the read to the operators who
 * are expected to triage it.
 */
async function Page() {
  const [workspace, permissions] = await Promise.all([
    loadCollectionsWorkspace(),
    getRoutePermissions("internal"),
  ]);
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="billing:read"
    >
      <CollectionsView
        cases={workspace.items}
        permissions={permissions}
        provenance={workspace.provenance}
        notice={<BillingOffNotice />}
      />
    </SurfacePermissionGate>
  );
}

export default withStaffPermission("operations:read", Page);
