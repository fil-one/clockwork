import type { ReplayableWebhookEvent } from "@clockwork/db";

import type { MessageId, Translator } from "@/src/i18n";

/**
 * The shortest reason a replay accepts. The server action refuses below it and
 * the help text states it, from this one constant.
 */
export const replayReasonMinimum = 8;

export const callbackStateLabels: Readonly<
  Record<ReplayableWebhookEvent["state"], MessageId>
> = {
  failed: "operations.webhookReplay.state.failed",
  unprocessed: "operations.webhookReplay.state.unprocessed",
  processed: "operations.webhookReplay.state.processed",
};

/** Which store answered; the page names it in the reader's language. */
export type ReplaySource = "live" | "demo" | "unavailable";

export const replaySourceLabels: Readonly<Record<ReplaySource, MessageId>> = {
  live: "operations.webhookReplay.source.live",
  demo: "operations.webhookReplay.source.demo",
  unavailable: "operations.webhookReplay.source.unavailable",
};

const outcomes: Readonly<Record<string, MessageId>> = {
  WEBHOOK_REPLAY_REASON_REQUIRED: "operations.decision.reasonRequired",
  WEBHOOK_REPLAY_RECENT_AUTH_REQUIRED:
    "operations.webhookReplay.failure.recentAuth",
  WEBHOOK_REPLAY_FORBIDDEN: "operations.webhookReplay.failure.forbidden",
  WEBHOOK_REPLAY_EVENT_NOT_FOUND: "operations.webhookReplay.failure.notFound",
  WEBHOOK_REPLAY_UNAVAILABLE: "operations.webhookReplay.failure.unavailable",
  WEBHOOK_REPLAY_ALREADY_RUNNING:
    "operations.webhookReplay.failure.alreadyRunning",
  WEBHOOK_REPLAY_INVALID: "operations.webhookReplay.failure.failed",
  WEBHOOK_REPLAY_FAILED: "operations.webhookReplay.failure.failed",
};

/** A refusal in the reader's language; unknown codes get the generic one. */
export function replayFailureMessage(
  code: string | undefined,
  t: Translator,
): string {
  const id = code && Object.hasOwn(outcomes, code) ? outcomes[code] : undefined;
  return t(id ?? "operations.webhookReplay.failure.failed", {
    min: replayReasonMinimum,
  });
}
