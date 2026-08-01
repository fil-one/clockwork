import { PriceBookAdministration } from "@/src/features/internal-ops/administration-safety/price-books";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  return <PriceBookAdministration roles={await getRouteRoles("internal")} />;
}
