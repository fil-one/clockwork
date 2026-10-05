import "server-only";

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
  if (!input.session.permissions.includes("impersonation:assume")) return [];
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
