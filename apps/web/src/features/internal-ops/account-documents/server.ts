import "server-only";
import type { AccountDocumentTarget } from "@clockwork/contracts";
import { AccountDocumentRepository } from "@clockwork/db";
import { getServiceDatabase } from "@/src/db/service";
import {
  contractStaff,
  documentStores,
  sessionHas,
  ContractAccessError,
} from "../contracts/server";

export async function accountDocumentStaff(
  target: AccountDocumentTarget,
  write = false,
) {
  const session = await contractStaff(
    target.type === "partner" ? "sales:read" : "operations:read",
  );
  if (write && !sessionHas(session, "contract:write"))
    throw new ContractAccessError("CONTRACT_FORBIDDEN");
  return session;
}
export const accountDocumentRepository = () =>
  new AccountDocumentRepository(getServiceDatabase(), documentStores);
