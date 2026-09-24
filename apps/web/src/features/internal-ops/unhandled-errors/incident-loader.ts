import "server-only";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getLocale } from "@/src/i18n/server";

import { readDemoRuntimeFailureIncidents } from "../demo-operator-state";

import {
  readRuntimeFailureIncidents,
  unreadableIncidentQueue,
  unwiredIncidentQueue,
} from "./incident-repository";
import type { IncidentQueue } from "./model";

/**
 * Resolves the service connection and delegates. The read itself takes an
 * explicit database so it can be exercised against a real one; this half exists
 * only to decide whether there is a connection to read with, and to report the
 * absence of one as an absence rather than as an empty queue.
 *
 * The two failures are kept apart. "No service connection is configured" and
 * "the query raised" send an operator to different places -- the first to the
 * deployment's environment, the second to the database or to this query -- and
 * a single unreadable state sent every reader to the connection string while a
 * broken query sat behind it.
 */
export async function loadRuntimeFailureIncidents(input: {
  requestId: string;
  limit?: number;
}): Promise<IncidentQueue> {
  const database = getOptionalServiceDatabase();
  if (!database && demoDeployIdentityEnabled(process.env))
    try {
      return await readDemoRuntimeFailureIncidents({
        locale: await getLocale(),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
    } catch {
      return unreadableIncidentQueue;
    }
  if (!database) return unwiredIncidentQueue;
  try {
    return await readRuntimeFailureIncidents(database, input);
  } catch {
    // The exception itself is not surfaced: the runbook's own step 1 forbids
    // putting an exception message where it can be read off a screen, and this
    // page is read off a screen.
    return unreadableIncidentQueue;
  }
}
