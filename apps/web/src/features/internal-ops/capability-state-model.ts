import type { SystemCapabilityKey } from "@clockwork/db";

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
 * The capability switches as a screen sees them. Pure, so client components
 * and tests can build one without reaching the database; the server read lives
 * in `capability-state.ts`.
 */
export interface CapabilityState {
  isEnabled(key: SystemCapabilityKey): boolean;
}

export const allCapabilitiesEnabled: CapabilityState = {
  isEnabled: () => true,
};

/**
 * The capability a record action needs before the command layer will run it.
 * Billing covers provisioning and invoicing together, as the workflow runtime
 * maps it; an action not listed here needs no switch.
 */
const actionCapabilities: Readonly<Record<string, SystemCapabilityKey>> = {
  evaluate_dunning: "billing",
  mark_uncollectible: "billing",
  open: "billing",
  pay: "billing",
  set_payment_terms: "billing",
  void: "billing",
  replay_provider_event: "billing",
  request_teardown: "teardown",
};

/** The actions whose capability is on, in their original order. */
export function availableActions(
  actions: readonly string[],
  capabilities: CapabilityState,
): readonly string[] {
  return actions.filter((action) => {
    const key = actionCapabilities[action];
    return !key || capabilities.isEnabled(key);
  });
}

/** Only a row that says enabled counts; a missing key is off. */
export function capabilityStateFrom(
  rows: readonly { capabilityKey: string; enabled: boolean }[],
): CapabilityState {
  const enabled = new Set(
    rows.filter((row) => row.enabled).map((row) => row.capabilityKey),
  );
  return { isEnabled: (key) => enabled.has(key) };
}
