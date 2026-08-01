import { AgreementAdministration } from "@/src/features/internal-ops/administration-safety/agreements";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  return <AgreementAdministration roles={await getRouteRoles("internal")} />;
}
