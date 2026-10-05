import {
  coreCommandCapabilities,
  type CoreCapabilityRequirement,
  type SystemCapabilityKey,
} from "@clockwork/db";

const capabilityKeys: readonly string[] = [
  "new_business",
  "legal",
  "billing",
  "partner",
  "marketplace",
  "teardown",
] satisfies readonly SystemCapabilityKey[];

export function isCapabilityKey(value: string): value is SystemCapabilityKey {
  return capabilityKeys.includes(value);
}

/**
 * The capability switches as a screen sees them, with no database access, so
 * tests can build one; the server read lives in `capability-state.ts`.
 *
 * Each switch has two halves, as `system_capabilities` stores them: `enabled`
 * lets new work start, `recovery_enabled` lets work already in flight finish
 * (dunning evaluation, credit notes, refunds, disputes, report exports).
 */
export interface CapabilityState {
  /** New work may start. */
  isEnabled(key: SystemCapabilityKey): boolean;
  /** Work already in flight may finish. */
  isRecoveryEnabled(key: SystemCapabilityKey): boolean;
}

export const allCapabilitiesEnabled: CapabilityState = {
  isEnabled: () => true,
  isRecoveryEnabled: () => true,
};

/** Some work for this capability can run: new work, or recovery of old work. */
export function isActive(
  capabilities: CapabilityState,
  key: SystemCapabilityKey,
): boolean {
  return capabilities.isEnabled(key) || capabilities.isRecoveryEnabled(key);
}

/**
 * Whether a requirement is met, read the way the server reads it
 * (`system_capability_is_enabled(key, recovery)`): recovery work needs each
 * switch's recovery half, new work its enabled half.
 */
export function meetsRequirement(
  capabilities: CapabilityState,
  requirement: CoreCapabilityRequirement,
): boolean {
  return requirement.capabilities.every((key) =>
    requirement.recovery
      ? capabilities.isRecoveryEnabled(key)
      : capabilities.isEnabled(key),
  );
}

/**
 * The core command resource behind each projected aggregate, as the
 * projection materializer binds them (`projectableResources` in
 * `@clockwork/workflows`). An aggregate outside this map is not a core command
 * and needs no switch here.
 */
const commandResources: Readonly<Record<string, string>> = {
  account: "accounts",
  quote: "quotes",
  order: "orders",
  amendment: "amendments",
  invoice: "invoices",
};

/**
 * The actions on a record the server would accept with the switches as they
 * are, in their original order. Requirements come from
 * `coreCommandCapabilities`, the function the command transaction enforces.
 */
export function availableActions(
  aggregateType: string,
  actions: readonly string[],
  capabilities: CapabilityState,
): readonly string[] {
  const resource = commandResources[aggregateType];
  if (!resource) return actions;
  return actions.filter((action) =>
    meetsRequirement(
      capabilities,
      coreCommandCapabilities({ resource, action }),
    ),
  );
}

/** Only a row that says so counts; a missing key is off for both halves. */
export function capabilityStateFrom(
  rows: readonly {
    capabilityKey: string;
    enabled: boolean;
    recoveryEnabled: boolean;
  }[],
): CapabilityState {
  const enabled = new Set(
    rows.filter((row) => row.enabled).map((row) => row.capabilityKey),
  );
  const recovery = new Set(
    rows.filter((row) => row.recoveryEnabled).map((row) => row.capabilityKey),
  );
  return {
    isEnabled: (key) => enabled.has(key),
    isRecoveryEnabled: (key) => recovery.has(key),
  };
}
