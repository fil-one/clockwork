import type { Metadata } from "next";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { operationalRoles } from "@/src/features/internal-ops/queue-search/model";
import { QueueWorkspace } from "@/src/features/internal-ops/queue-search/queue-workspace";
import { loadQueueWorkspace } from "@/src/features/internal-ops/queue-search/server-loader";
import { getRouteSession } from "@/src/features/shell/route-session";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.queue.title") };
}

export default async function Page() {
  const [session, workspace] = await Promise.all([
    getRouteSession("internal"),
    loadQueueWorkspace(),
  ]);
  const actor = session.memberships.find(
    (membership) => membership.userEmail === session.profile.email,
  );
  return (
    <QueueWorkspace
      roles={operationalRoles(session.roles)}
      items={workspace.items}
      generatedAt={workspace.generatedAt}
      stale={workspace.stale}
      actorId={actor?.userId ?? null}
      demoRefreshEnabled={demoDeployIdentityEnabled(process.env)}
    />
  );
}
