import "server-only";

import {
  DatabaseWebhookReplayReadModel,
  type ReplayableWebhookEvent,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

import { readDemoWebhookEvents } from "../demo-operator-state";

import type { ReplaySource } from "./copy";

export type { ReplayableWebhookEvent };

export interface WebhookReplayQueue {
  events: readonly ReplayableWebhookEvent[];
  /** Which store answered; the page names it in the reader's language. */
  source: ReplaySource;
  readable: boolean;
}

const unreadable: WebhookReplayQueue = {
  events: [],
  source: "unavailable",
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
  if (!database && demoDeployIdentityEnabled(process.env)) {
    try {
      const events = await readDemoWebhookEvents({
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
      return {
        events,
        source: "demo",
        readable: true,
      };
    } catch {
      return unreadable;
    }
  }
  if (!database) return unreadable;
  try {
    const events = await new DatabaseWebhookReplayReadModel(database).list({
      requestId: input.requestId,
      limit: input.limit ?? 100,
      ...(input.provider ? { provider: input.provider } : {}),
    });
    return { events, source: "live", readable: true };
  } catch {
    return unreadable;
  }
}
