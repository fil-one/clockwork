import type { Metadata } from "next";

import { loadOperationalQueueStatus } from "@/src/features/internal-ops/status/status-loader";
import { IntegrationStatusView } from "@/src/features/internal-ops/status/status-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.status.title") };
}

export default async function Page() {
  const queues = await loadOperationalQueueStatus({
    requestId: `experience:status:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <IntegrationStatusView queues={queues} />
    </SurfacePermissionGate>
  );
}
