import "server-only";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

import { readDemoReconciliationWorkspace } from "../demo-operator-state";

import type { ReconciliationWorkspace } from "./model";
import {
  readReconciliationWorkspace,
  unreadableReconciliationWorkspace,
} from "./reconciliation-repository";

/**
 * Resolves the service connection and delegates. The read itself takes an
 * explicit database so it can be exercised against a real one; this half exists
 * only to decide whether there is a connection to read with, and to report the
 * absence of one as an absence rather than as a clean close.
 */
export async function loadReconciliationWorkspace(input: {
  requestId: string;
  limit?: number;
}): Promise<ReconciliationWorkspace> {
  const database = getOptionalServiceDatabase();
  if (!database && demoDeployIdentityEnabled(process.env))
    try {
      return await readDemoReconciliationWorkspace({
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
    } catch {
      return unreadableReconciliationWorkspace;
    }
  if (!database) return unreadableReconciliationWorkspace;
  try {
    return await readReconciliationWorkspace(database, input);
  } catch {
    return unreadableReconciliationWorkspace;
  }
}
