import { contextHasPermission } from "@clockwork/contracts";
import type { Metadata } from "next";
import { DatabaseCustomerAcquisitionRepository } from "@clockwork/db";
import type { CustomerAcquisitionRequest } from "@clockwork/domain/core";
import { getCommerceSession } from "@/src/auth/session";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { DemoCustomerAcquisitionRepository } from "@/src/features/customer-partner/acquisition/demo";
import { AcquisitionFinance } from "@/src/features/customer-partner/acquisition/finance";
import { getTranslations } from "@/src/i18n/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminPricing.payg.requestsPageTitle") };
}
async function Page() {
  const session = await getCommerceSession();
  const demo = demoDeployIdentityEnabled(process.env);
  let requests: CustomerAcquisitionRequest[] = [];
  let available = false;
  if (
    session.isInternalStaff &&
    contextHasPermission(session, "quote:approve") &&
    !session.impersonation &&
    !session.assistedSession
  ) {
    try {
      if (demo) {
        requests = await new DemoCustomerAcquisitionRepository().listInternal(
          session.userId,
        );
        available = true;
      } else {
        const database = getOptionalServiceDatabase();
        if (database && session.providerBacked) {
          requests = await new DatabaseCustomerAcquisitionRepository(
            database,
          ).listInternal(session.userId);
          available = true;
        }
      }
    } catch {
      /* Fail closed. */
    }
  }
  return (
    <AcquisitionFinance requests={requests} demo={demo} available={available} />
  );
}

export default withStaffPermission("operations:read", Page);
