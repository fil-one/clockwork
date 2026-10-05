import type { Metadata } from "next";

import { loadTeamView } from "@/src/features/internal-ops/team/server";
import { TeamWorkspace } from "@/src/features/internal-ops/team/team-workspace";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  // The root template appends the product name.
  return { title: t("operations.team.title") };
}

async function Page() {
  return <TeamWorkspace view={await loadTeamView()} />;
}

export default withStaffPermission("staff:manage", Page);
