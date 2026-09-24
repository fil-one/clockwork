import type { Metadata } from "next";

import { loadReplayableWebhookEvents } from "@/src/features/internal-ops/webhook-replay/webhook-replay-loader";
import { WebhookReplayView } from "@/src/features/internal-ops/webhook-replay/webhook-replay-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getTranslations } from "@/src/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.webhookReplay.title") };
}

export default async function Page() {
  const queue = await loadReplayableWebhookEvents({
    requestId: `experience:webhook-replay:${crypto.randomUUID()}`,
  });
  return (
    <SurfacePermissionGate
      audience="internal"
      requiredPermission="system:operate"
    >
      <WebhookReplayView queue={queue} />
    </SurfacePermissionGate>
  );
}
