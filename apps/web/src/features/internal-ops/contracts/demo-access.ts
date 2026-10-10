import "server-only";
import type { Permission } from "@clockwork/contracts";
import type { ContractRepository, SalesLibraryRepository } from "@clockwork/db";
import {
  explicitDemoIdentityEnabled,
  getCommerceSession,
} from "@/src/auth/session";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import { demoContractRegister, demoSalesLibrary } from "./demo-register";
import {
  ContractAccessError,
  contractRepository,
  contractStaff,
  salesLibraryRepository,
  sessionHas,
  type ContractStaffSession,
} from "./server";

/** What a demo persona may do here: read, and see signed MNDAs. */
const demoPermissions: readonly Permission[] = [
  "contract:read",
  "sales:read",
  "mnda:send",
];

/**
 * The session for a contract or sales-library read. In the guided demo a
 * staff persona reads the fictional register with every write and approval
 * permission removed, so no write control renders; anything else in the demo
 * is refused as before. Outside the demo this is `contractStaff`.
 */
export async function contractReader(
  permission: Permission,
): Promise<ContractStaffSession> {
  if (!explicitDemoIdentityEnabled()) return contractStaff(permission);
  if (permission !== "contract:read" && permission !== "sales:read")
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const session = await getCommerceSession();
  if (
    !session.isInternalStaff ||
    session.impersonation ||
    session.assistedSession ||
    !sessionHas(session, permission)
  )
    throw new ContractAccessError("CONTRACT_FORBIDDEN");
  return {
    ...session,
    permissions: session.permissions.filter((p) => demoPermissions.includes(p)),
  };
}

type RegisterReader = Pick<
  ContractRepository,
  | "list"
  | "exportRows"
  | "get"
  | "noticesPassed"
  | "renewalsDue"
  | "renewalSummary"
>;

/** The register's reads: the demo fixtures in the guided demo. */
export function contractRegisterReader(): RegisterReader {
  return explicitDemoIdentityEnabled()
    ? demoContractRegister(demoNow())
    : contractRepository();
}

export function salesLibraryReader(): Pick<SalesLibraryRepository, "list"> {
  return explicitDemoIdentityEnabled()
    ? demoSalesLibrary(demoNow())
    : salesLibraryRepository();
}
