import { inArray } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { systemCapabilities } from "../../schema/system";
import { withInternalTransaction } from "../../transaction";

export const systemCapabilityKeys = [
  "new_business",
  "legal",
  "billing",
  "partner",
  "marketplace",
  "teardown",
] as const;

export type SystemCapabilityKey = (typeof systemCapabilityKeys)[number];

/** Re-reads persisted capability state for every command attempt. */
export class DatabaseSystemCapabilityGuard {
  public constructor(private readonly database: RuntimeDatabase) {}

  public require(input: {
    capabilities: readonly SystemCapabilityKey[];
    recovery: boolean;
    requestId: string;
  }): Promise<{ allowed: boolean; disabled: readonly SystemCapabilityKey[] }> {
    const requested = [...new Set(input.capabilities)].sort();
    return withInternalTransaction(
      this.database,
      input.requestId,
      async (transaction) => {
        const rows =
          requested.length === 0
            ? []
            : await transaction
                .select()
                .from(systemCapabilities)
                .where(inArray(systemCapabilities.capabilityKey, requested));
        const byKey = new Map(rows.map((row) => [row.capabilityKey, row]));
        const disabled = requested.filter((key) => {
          const row = byKey.get(key);
          return input.recovery
            ? row?.recoveryEnabled !== true
            : row?.enabled !== true;
        });
        return { allowed: disabled.length === 0, disabled };
      },
    );
  }
}
