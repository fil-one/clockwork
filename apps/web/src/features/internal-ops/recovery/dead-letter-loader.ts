import "server-only";

import {
  DatabaseDeadLetterReadModel,
  type DeadLetterOperation,
  type DeadLetterSource,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";

import { recoveryCopy } from "./copy";

export type { DeadLetterOperation, DeadLetterSource };

export type DeadLetterSourceLabel =
  (typeof recoveryCopy.sourceLabel)[keyof typeof recoveryCopy.sourceLabel];

export interface DeadLetterResult {
  operations: readonly DeadLetterOperation[];
  source: DeadLetterSourceLabel;
  readable: boolean;
}

/**
 * Reads stopped work for the operator queue.
 *
 * A queue that cannot be read reports that it cannot be read. It never falls
 * back to a sample, because an empty recovery queue and an unreadable one lead
 * an operator to opposite conclusions.
 */
export async function loadDeadLetterOperations(input: {
  requestId: string;
  sources?: readonly DeadLetterSource[];
}): Promise<DeadLetterResult> {
  const database = getOptionalServiceDatabase();
  if (!database)
    return {
      operations: [],
      source: recoveryCopy.sourceLabel.unavailable,
      readable: false,
    };
  try {
    const operations = await new DatabaseDeadLetterReadModel(database).list({
      requestId: input.requestId,
      limit: 100,
      ...(input.sources ? { sources: input.sources } : {}),
    });
    return {
      operations,
      source: recoveryCopy.sourceLabel.live,
      readable: true,
    };
  } catch {
    return {
      operations: [],
      source: recoveryCopy.sourceLabel.unavailable,
      readable: false,
    };
  }
}
