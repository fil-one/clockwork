import type { Metadata } from "next";
import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import { AssistedMode } from "@/src/features/internal-ops/administration-safety/assisted";
import { adminSafetyCopy } from "@/src/features/internal-ops/administration-safety/copy";
import { accounts as demoAccounts } from "@/src/features/internal-ops/administration-safety/data";
import { loadAssistedAccountOptions } from "@/src/features/internal-ops/assisted-session/account-options";
import { getRouteSession } from "@/src/features/shell/route-session";
import { getServiceDatabase } from "@/src/db/service";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getLocale, getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(adminSafetyCopy.assisted.title) };
}

export default async function Page() {
  const session = await getRouteSession("internal");
  const accounts = session.providerBacked
    ? await loadAssistedAccountOptions(getServiceDatabase(), {
        session,
        requestId: `assisted-accounts:${crypto.randomUUID()}`,
      })
    : resolveDemoText(demoAccounts, await getLocale());
  return (
    <AssistedMode
      roles={session.roles}
      accounts={accounts}
      actor={`${session.profile.name} · ${session.profile.email}`}
      sessionActive={Boolean(session.assistedSession)}
      guidedDemo={demoDeployIdentityEnabled(process.env)}
    />
  );
}
