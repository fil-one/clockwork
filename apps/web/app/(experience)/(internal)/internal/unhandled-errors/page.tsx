import type { Metadata } from "next";

import { loadRuntimeFailureIncidents } from "@/src/features/internal-ops/unhandled-errors/incident-loader";
import { UnhandledErrorsView } from "@/src/features/internal-ops/unhandled-errors/unhandled-errors-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.incidents.title") };
}

export default async function Page() {
  const result = await loadRuntimeFailureIncidents({
    requestId: `experience:unhandled-errors:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <UnhandledErrorsView result={result} />
    </SurfacePermissionGate>
  );
}
