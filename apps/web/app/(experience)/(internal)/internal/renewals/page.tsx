import type { Metadata } from "next";

import { getTranslations } from "@/src/i18n/server";
import { RenewalsView } from "@/src/features/internal-ops/finance-lifecycle/renewals-view";
import { loadRenewalsWorkspace } from "@/src/features/internal-ops/finance-lifecycle/server-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.finance.renewals.title") };
}

/**
 * Renewal work is read from the internal `orders` channel. No aggregate routes
 * to an internal `renewals` channel, so reading `renewals` here would return an
 * empty page forever.
 *
 * The gate stays `report:read` rather than becoming `order:read` even though
 * the rows are orders now. `order:read` is not held by `finance_approver`, who
 * could open this surface before, and narrowing a read that nobody asked to
 * narrow would take the page away from the role that plans renewals. Row
 * visibility is enforced by the projection read itself, not by this gate.
 */
export default async function Page() {
  const workspace = await loadRenewalsWorkspace();
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <RenewalsView
        windows={workspace.items}
        provenance={workspace.provenance}
        invoiceProvenance={workspace.invoiceProvenance}
      />
    </SurfacePermissionGate>
  );
}
