import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { MigrationsView } from "@/src/features/internal-ops/finance-lifecycle/migrations-view";
import { readDemoMigrationDecisions } from "@/src/features/internal-ops/demo-operator-state";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

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
