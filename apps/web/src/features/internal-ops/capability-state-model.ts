import type { SystemCapabilityKey } from "@clockwork/db";

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

/** Only a row that says enabled counts; a missing key is off. */
export function capabilityStateFrom(
  rows: readonly { capabilityKey: string; enabled: boolean }[],
): CapabilityState {
  const enabled = new Set(
    rows.filter((row) => row.enabled).map((row) => row.capabilityKey),
  );
  return { isEnabled: (key) => enabled.has(key) };
}
