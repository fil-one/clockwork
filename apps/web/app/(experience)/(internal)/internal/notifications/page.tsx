import type { Metadata } from "next";

import { InlineNotice } from "@clockwork/ui";

import { NotificationInbox } from "@/src/features/internal-ops/notifications/notification-inbox";
import { loadNotificationInbox } from "@/src/features/internal-ops/notifications/page-data";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.notifications.title") };
}

/** Every staff member's own inbox; what it holds follows their permissions. */
export default async function Page() {
  const [loaded, t] = await Promise.all([
    loadNotificationInbox(),
    getTranslations(),
  ]);
  if (loaded.kind === "ready")
    return <NotificationInbox initial={loaded.value} />;
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
