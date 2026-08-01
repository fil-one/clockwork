import { AssistedMode } from "@/src/features/internal-ops/administration-safety/assisted";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  return <AssistedMode roles={await getRouteRoles("internal")} />;
}
