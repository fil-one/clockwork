import { task } from "@trigger.dev/sdk";
import { WEBHOOK_REPLAY_TASK_ID } from "@clockwork/db";
import { z } from "zod";

import { durableRetryPolicy } from "../policy";
import { executeConfiguredWebhookReplay } from "./runtime";

const PayloadSchema = z.object({ workflowRunId: z.uuid() }).strict();

export const webhookReplayTask = task({
  id: WEBHOOK_REPLAY_TASK_ID,
  retry: durableRetryPolicy,
  run: (raw: unknown, { ctx }) => {
    const payload = PayloadSchema.parse(raw);
    return executeConfiguredWebhookReplay({
      workflowRunId: payload.workflowRunId,
      triggerRunId: ctx.run.id,
      attempt: ctx.attempt.number,
    });
  },
});
