import "server-only";

import { loadDeadLetterOperations } from "../recovery/dead-letter-loader";
import { loadReplayableWebhookEvents } from "../webhook-replay/webhook-replay-loader";

export interface OperationalQueueStatus {
  dispatch: number;
  provisioning: number;
  workflow: number;
  webhook: number;
  deadLettersReadable: boolean;
  webhooksReadable: boolean;
}

/** Counts only records actually returned by the two capped operator readers. */
export async function loadOperationalQueueStatus(input: {
  requestId: string;
}): Promise<OperationalQueueStatus> {
  const [deadLetters, webhooks] = await Promise.all([
    loadDeadLetterOperations({ requestId: `${input.requestId}:dead-letter` }),
    loadReplayableWebhookEvents({
      requestId: `${input.requestId}:webhook-replay`,
      limit: 100,
    }),
  ]);
  const count = (
    source: "outbox_message" | "provisioning_attempt" | "workflow_run",
  ) =>
    deadLetters.operations.filter((operation) => operation.source === source)
      .length;
  return {
    dispatch: count("outbox_message"),
    provisioning: count("provisioning_attempt"),
    workflow: count("workflow_run"),
    webhook: webhooks.events.length,
    deadLettersReadable: deadLetters.readable,
    webhooksReadable: webhooks.readable,
  };
}
