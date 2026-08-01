import { AssistedMode } from "@/src/features/internal-ops/administration-safety/assisted";
import { accounts as demoAccounts } from "@/src/features/internal-ops/administration-safety/data";
import { loadAssistedAccountOptions } from "@/src/features/internal-ops/assisted-session/account-options";
import { getRouteSession } from "@/src/features/shell/route-session";
import { getServiceDatabase } from "@/src/db/service";

export default async function Page() {
  const session = await getRouteSession("internal");
  const accounts = session.providerBacked
    ? await loadAssistedAccountOptions(getServiceDatabase(), {
        session,
        requestId: `assisted-accounts:${crypto.randomUUID()}`,
      })
    : demoAccounts;
  return (
    <AssistedMode
      roles={session.roles}
      accounts={accounts}
      actor={`${session.profile.name} · ${session.profile.email}`}
      sessionActive={Boolean(session.assistedSession)}
    />
  );
}
