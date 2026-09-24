import type { Metadata } from "next";

import { loadDeadLetterOperations } from "@/src/features/internal-ops/recovery/dead-letter-loader";
import { RecoveryView } from "@/src/features/internal-ops/recovery/recovery-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.recovery.title") };
}

export default async function Page() {
  const result = await loadDeadLetterOperations({
    requestId: `experience:recovery-queue:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <RecoveryView result={result} />
    </SurfacePermissionGate>
  );
}
