import type { Metadata } from "next";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { OperationsHome } from "@/src/features/internal-ops/operations-home/operations-home";
import { loadOperationsHome } from "@/src/features/internal-ops/operations-home/server-loader";
import { withStaffPermission } from "@/src/features/shell/staff-access";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.home.title") };
}

async function Page() {
  return (
    <OperationsHome
      data={await loadOperationsHome(
        new Date(),
        await getTranslations(),
        await getFormattingLocale(),
      )}
    />
  );
}

export default withStaffPermission("operations:read", Page);
