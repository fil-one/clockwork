import { OperationsHome } from "@/src/features/internal-ops/operations-home/operations-home";
import { loadOperationsHome } from "@/src/features/internal-ops/operations-home/server-loader";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <OperationsHome data={await loadOperationsHome()} />;
}
