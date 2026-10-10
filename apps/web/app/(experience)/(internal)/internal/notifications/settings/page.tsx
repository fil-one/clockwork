import type { Metadata } from "next";

import { InlineNotice } from "@clockwork/ui";

import { loadNotificationSettings } from "@/src/features/internal-ops/notifications/page-data";
import { NotificationSettingsWorkspace } from "@/src/features/internal-ops/notifications/settings-workspace";
import { withStaffPermission } from "@/src/features/shell/staff-access";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.notifications.settings.title") };
}

async function Page() {
  const [loaded, t] = await Promise.all([
    loadNotificationSettings(),
    getTranslations(),
  ]);
  if (loaded.kind === "ready")
    return <NotificationSettingsWorkspace initial={loaded.value} />;
  return (
    <main className="experience-main" id="main-content">
      <InlineNotice
        tone={loaded.kind === "forbidden" ? "warning" : "danger"}
        title={t(
          loaded.kind === "forbidden"
            ? "operations.notifications.forbidden"
            : "operations.notifications.unavailable",
        )}
      />
    </main>
  );
}

export default withStaffPermission("staff:manage", Page);
