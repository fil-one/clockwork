import type { Metadata } from "next";

import { getTranslations } from "@/src/i18n/server";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { MigrationsView } from "@/src/features/internal-ops/finance-lifecycle/migrations-view";
import { readDemoMigrationDecisions } from "@/src/features/internal-ops/demo-operator-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.finance.migrations.title") };
}

export default async function Page() {
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  const decisions = guidedDemo ? await readDemoMigrationDecisions() : [];
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <MigrationsView guidedDemo={guidedDemo} decisions={decisions} />
    </SurfacePermissionGate>
  );
}
