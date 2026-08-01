import { AssistedMode } from "@/src/features/internal-ops/administration-safety/assisted";
import { AssistedSessionBanner } from "@/src/features/internal-ops/assisted-session/assisted-session-banner";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  return (
    <>
      <AssistedSessionBanner />
      <AssistedMode roles={await getRouteRoles("internal")} />
    </>
  );
}
