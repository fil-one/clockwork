import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { DemoCommercialPolicyRepository } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { DatabasePaygOfferRepository } from "@clockwork/db";
import type { PaygOfferRecord } from "@clockwork/domain/core";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { getCommerceSession } from "@/src/auth/session";
import { PaygOfferAdministration } from "@/src/features/internal-ops/administration-safety/payg-offers";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await getCommerceSession();
  if (!session.isInternalStaff)
    throw new Error("Internal staff authority is required");
  const roles = session.roles;
  const database = getOptionalServiceDatabase();
  let offers: PaygOfferRecord[] = [];
  let available = false;
  const demo = demoDeployIdentityEnabled(process.env);
  if (demo && roles.includes("finance_approver")) {
    offers = await new DemoCommercialPolicyRepository().listPayg();
    available = true;
  }
  if (
    !demo &&
    database &&
    session.providerBacked &&
    roles.includes("finance_approver")
  ) {
    try {
      offers = await new DatabasePaygOfferRepository(database).list();
      available = true;
    } catch {
      /* An unavailable authoritative service never becomes a fixture. */
    }
  }
  return (
    <PaygOfferAdministration
      demo={demo}
      roles={roles}
      userId={session.userId}
      offers={offers}
      available={available}
    />
  );
}
