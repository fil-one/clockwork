import type { Metadata } from "next";

import { getTranslations } from "@/src/i18n/server";
import { CollectionsView } from "@/src/features/internal-ops/finance-lifecycle/collections-view";
import { loadCollectionsWorkspace } from "@/src/features/internal-ops/finance-lifecycle/server-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";

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
export default async function Page() {
  const [workspace, roles] = await Promise.all([
    loadCollectionsWorkspace(),
    getRouteRoles("internal"),
  ]);
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="billing:read"
    >
      <CollectionsView
        cases={workspace.items}
        roles={roles}
        provenance={workspace.provenance}
      />
    </SurfacePermissionGate>
  );
}
