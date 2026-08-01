import { DatabaseExternalGateService } from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { GateRegister } from "@/src/features/internal-ops/administration-safety/gates";
import { getRouteRoles } from "@/src/features/shell/route-session";

import { loadConfiguredGateRecords } from "@/src/features/internal-ops/gates/server-gate-loader";

export const dynamic = "force-dynamic";

const serviceDatabase = getOptionalServiceDatabase();
const gateService = serviceDatabase
  ? new DatabaseExternalGateService(serviceDatabase)
  : undefined;

export default async function Page() {
  const [roles, configured] = await Promise.all([
    getRouteRoles("internal"),
    loadConfiguredGateRecords(gateService),
  ]);
  return (
    <GateRegister
      roles={roles}
      gates={configured.gates}
      source={configured.source}
    />
  );
}
