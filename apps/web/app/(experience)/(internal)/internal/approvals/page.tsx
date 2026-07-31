import { ApprovalWorkspace } from "@/src/features/internal-ops/administration-safety/approvals";
import { getRouteRoles } from "@/src/features/shell/route-session";

export default async function Page() {
  return <ApprovalWorkspace roles={await getRouteRoles("internal")} />;
}
