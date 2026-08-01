import "server-only";

import { hasPermission, RoleSchema } from "@clockwork/contracts";
import type { RuntimeDatabase } from "@clockwork/db";

import type { RouteSession } from "@/src/features/shell/route-session";

import { listAssistableAccounts } from "./repository";

export interface AssistedAccountOption {
  id: string;
  label: string;
}

export async function loadAssistedAccountOptions(
  db: RuntimeDatabase,
  input: { session: RouteSession; requestId: string },
  listAccounts: typeof listAssistableAccounts = listAssistableAccounts,
): Promise<AssistedAccountOption[]> {
  const mayAssume = input.session.roles.some((value) => {
    const role = RoleSchema.safeParse(value);
    return role.success && hasPermission(role.data, "impersonation:assume");
  });
  if (!mayAssume) return [];
  if (input.session.assistedSession)
    return [
      {
        id: input.session.assistedSession.targetAccountId,
        label: input.session.assistedSession.targetAccountName,
      },
    ];
  const accounts = await listAccounts(db, { requestId: input.requestId });
  return accounts.map(({ id, name }) => ({ id, label: name }));
}
