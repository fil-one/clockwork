import type { Metadata } from "next";

import { getTranslations } from "@/src/i18n/server";
import { loadRevenueWorkspace } from "@/src/features/internal-ops/revenue/revenue-loader";
import { RevenueView } from "@/src/features/internal-ops/revenue/revenue-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.finance.revenue.title") };
}

export default async function Page() {
  const workspace = await loadRevenueWorkspace({
    requestId: `experience:revenue:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate audience="internal" requiredPermission="report:read">
      <RevenueView workspace={workspace} />
    </SurfacePermissionGate>
  );
}
