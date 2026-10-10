import "server-only";

import { cache } from "react";

import {
  DatabaseSystemCapabilityAdmin,
  type SystemCapabilityKey,
} from "@clockwork/db";

import { getOptionalServiceDatabase } from "@/src/db/service";

import {
  allCapabilitiesEnabled,
  capabilityStateFrom,
  isActive,
  type CapabilityState,
} from "./capability-state-model";

export {
  allCapabilitiesEnabled,
  capabilityStateFrom,
  isActive,
  type CapabilityState,
  type SystemCapabilityKey,
};

/**
 * Which commerce capability switches are on, for deciding what staff screens
 * show. Read-only: switches change on the Capabilities page, and every command
 * re-checks its switch on the server when it runs, so this decides
 * presentation only.
 *
 * - A session backed by the identity provider reads the `system_capabilities`
 *   table, both its `enabled` and `recovery_enabled` columns. A missing row, or
 *   a read that fails, counts as off: a screen must not present billing work as
 *   live on a guess.
 * - The no-database demo has no switch table. It simulates a running platform
 *   (its customer journeys pay invoices), so every capability counts as on.
 */
const readCapabilityRows = cache(async () => {
  const db = getOptionalServiceDatabase();
  if (!db) return [];
  return new DatabaseSystemCapabilityAdmin(db).list({
    requestId: `capability-state:${crypto.randomUUID()}`,
  });
});

export async function getCapabilityState(session: {
  providerBacked: boolean;
}): Promise<CapabilityState> {
  if (!session.providerBacked) return allCapabilitiesEnabled;
  try {
    return capabilityStateFrom(await readCapabilityRows());
  } catch (error) {
    console.error("Capability state could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return capabilityStateFrom([]);
  }
}
