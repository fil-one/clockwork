import { DatabaseCustomerAcquisitionRepository } from "@clockwork/db";
import type { CustomerAcquisitionView } from "@clockwork/domain/core";
import { getCommerceSession } from "@/src/auth/session";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { CustomerAcquisition } from "@/src/features/customer-partner/acquisition/customer";
import { DemoCustomerAcquisitionRepository } from "@/src/features/customer-partner/acquisition/demo";
export const dynamic = "force-dynamic";
async function Workspace() {
  const session = await getCommerceSession();
  const demo = demoDeployIdentityEnabled(process.env);
  const accountId = session.selectedAccountId ?? "";
  let view: CustomerAcquisitionView = {
    offers: [],
    organizations: [],
    requests: [],
  };
  let available = false;
  if (
    !session.isInternalStaff &&
    !session.impersonation &&
    !session.assistedSession
  ) {
    const input = {
      userId: session.userId,
      accountId,
      now: new Date().toISOString(),
    };
    try {
      if (demo) {
        view = await new DemoCustomerAcquisitionRepository().list(input);
        available = true;
      } else {
        const database = getOptionalServiceDatabase();
        if (database && session.providerBacked) {
          view = await new DatabaseCustomerAcquisitionRepository(database).list(
            input,
          );
          available = true;
        }
      }
    } catch {
      /* Authoritative failure never becomes demo data. */
    }
  }
  return (
    <CustomerAcquisition
      view={view}
      accountId={accountId}
      demo={demo}
      available={available}
    />
  );
}
export default function Page() {
  return (
    <SurfacePermissionGate audience="customer" requiredPermission="quote:write">
      <Workspace />
    </SurfacePermissionGate>
  );
}
