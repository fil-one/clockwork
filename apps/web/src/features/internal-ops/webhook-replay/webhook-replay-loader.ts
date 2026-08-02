import "server-only";

import {
  DatabaseWebhookReplayReadModel,
  type ReplayableWebhookEvent,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";

import { webhookReplayCopy } from "./copy";

export type { ReplayableWebhookEvent };

export interface WebhookReplayQueue {
  events: readonly ReplayableWebhookEvent[];
  source: string;
  readable: boolean;
}

const unreadable: WebhookReplayQueue = {
  events: [],
  source: webhookReplayCopy.sourceUnreadable,
  readable: false,
};

/**
 * Reads the callbacks an operator may replay.
 *
 * A store that cannot be read reports that it cannot be read. It never falls
 * back to a sample, because no stopped callbacks and no way to see them lead an
 * operator to opposite conclusions.
 */
export async function loadReplayableWebhookEvents(input: {
  requestId: string;
  provider?: string;
  limit?: number;
}): Promise<WebhookReplayQueue> {
  const database = getOptionalServiceDatabase();
  if (!database) return unreadable;
  try {
    const events = await new DatabaseWebhookReplayReadModel(database).list({
      requestId: input.requestId,
      limit: input.limit ?? 100,
      ...(input.provider ? { provider: input.provider } : {}),
    });
    return { events, source: webhookReplayCopy.sourceReadable, readable: true };
  } catch {
    return unreadable;
  }
}
