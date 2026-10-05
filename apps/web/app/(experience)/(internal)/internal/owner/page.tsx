import type { Metadata } from "next";

import { OwnerConsole } from "@/src/features/internal-ops/owner-console/owner-console";
import { loadOwnerConsole } from "@/src/features/internal-ops/owner-console/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  // The root template appends the product name.
  return { title: t("operations.owner.title") };
}

async function Page() {
  return <OwnerConsole view={await loadOwnerConsole()} />;
}

export default withStaffPermission("staff:manage", Page);
