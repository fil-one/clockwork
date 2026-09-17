import { WEBHOOK_REPLAY_TASK_ID } from "@clockwork/db";
import { z } from "zod";

import { defineTask } from "../tasks/definition";
import { executeConfiguredWebhookReplay } from "./runtime";

const PayloadSchema = z.object({ workflowRunId: z.uuid() }).strict();

export const webhookReplayTask = defineTask({
  id: WEBHOOK_REPLAY_TASK_ID,
  schema: PayloadSchema,
  run: (payload, ctx) =>
    executeConfiguredWebhookReplay({
      workflowRunId: payload.workflowRunId,
      triggerRunId: ctx.runId,
      attempt: ctx.attempt,
    }),
});
