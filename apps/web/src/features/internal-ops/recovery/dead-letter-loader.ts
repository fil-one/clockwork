import "server-only";

import {
  DatabaseDeadLetterReadModel,
  type DeadLetterOperation,
  type DeadLetterSource,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

import { readDemoDeadLetters } from "../demo-operator-state";

import type { RecoverySource } from "./copy";

export type { DeadLetterOperation, DeadLetterSource };

export interface DeadLetterResult {
  operations: readonly DeadLetterOperation[];
  /** Which store answered; the page names it in the reader's language. */
  source: RecoverySource;
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
  if (!database && demoDeployIdentityEnabled(process.env)) {
    try {
      return {
        operations: await readDemoDeadLetters({
          ...(input.sources ? { sources: input.sources } : {}),
        }),
        source: "demo",
        readable: true,
      };
    } catch {
      return {
        operations: [],
        source: "unavailable",
        readable: false,
      };
    }
  }
  if (!database)
    return {
      operations: [],
      source: "unavailable",
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
      source: "live",
      readable: true,
    };
  } catch {
    return {
      operations: [],
      source: "unavailable",
      readable: false,
    };
  }
}
