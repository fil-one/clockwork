import type { Metadata } from "next";
import { DatabaseExternalGateService } from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { adminSafetyCopy } from "@/src/features/internal-ops/administration-safety/copy";
import { demoGateText } from "@/src/features/internal-ops/administration-safety/data";
import { GateRegister } from "@/src/features/internal-ops/administration-safety/gates";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { getLocale, getTranslations } from "@/src/i18n/server";

import { loadConfiguredGateRecords } from "@/src/features/internal-ops/gates/server-gate-loader";

export const dynamic = "force-dynamic";

const serviceDatabase = getOptionalServiceDatabase();
const gateService = serviceDatabase
  ? new DatabaseExternalGateService(serviceDatabase)
  : undefined;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t(adminSafetyCopy.gates.title) };
}

export default async function Page() {
  const [roles, configured, locale] = await Promise.all([
    getRouteRoles("internal"),
    loadConfiguredGateRecords(gateService),
    getLocale(),
  ]);
  return (
    <GateRegister
      roles={roles}
      gates={configured.gates}
      source={configured.source}
      {...(configured.source === "System gate registry"
        ? {}
        : { demoText: demoGateText(locale) })}
    />
  );
}
