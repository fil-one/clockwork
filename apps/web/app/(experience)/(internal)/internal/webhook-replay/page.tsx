import { loadReplayableWebhookEvents } from "@/src/features/internal-ops/webhook-replay/webhook-replay-loader";
import { WebhookReplayView } from "@/src/features/internal-ops/webhook-replay/webhook-replay-view";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";

export const dynamic = "force-dynamic";

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
