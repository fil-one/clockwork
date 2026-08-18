import "server-only";

import type { DatabaseExternalGateService } from "@clockwork/db";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

import {
  fallbackGates,
  type GateRecord,
} from "@/src/features/internal-ops/administration-safety/data";
import { presentGeneratedGate } from "@/src/features/internal-ops/administration-safety/gates";
import { readDemoExternalGates } from "./demo-gate-state";

export type GateRecordSource =
  | "System gate registry"
  | "Demonstration gate registry"
  | "Fail-closed operational fallback";

export interface GateRecordResult {
  gates: readonly GateRecord[];
  source: GateRecordSource;
}

const unavailableRegistry: GateRecord = {
  id: "SYSTEM-GATE-REGISTRY-UNAVAILABLE",
  group: "Operations",
  title: "External-gate registry unavailable",
  owner: "Platform operations",
  capability: "All externally gated capabilities",
  activationTest: "Not available; activation is denied",
  severity: "Launch blocker",
  state: "Blocked",
  freshness: "No registry read is available for this request",
  reason: "The persistent gate registry could not be read. No gate is active.",
};

function failClosed(runtimeEnvironment: string): GateRecordResult {
  const allowDemoFallback =
    !findDemoProductionMarker(process.env) &&
    runtimeEnvironment.trim().toLowerCase() !== "production";
  return {
    gates: allowDemoFallback ? fallbackGates : [unavailableRegistry],
    source: "Fail-closed operational fallback",
  };
}

/**
 * Read the registry through the service database. There is intentionally no
 * URL, outbound fetch, request header, or cookie parameter on this boundary.
 */
export async function loadConfiguredGateRecords(
  service: Pick<DatabaseExternalGateService, "list"> | undefined,
  input: { requestId?: string; now?: Date; runtimeEnvironment?: string } = {},
): Promise<GateRecordResult> {
  const runtimeEnvironment =
    input.runtimeEnvironment ??
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ??
    "local";
  if (!service && demoDeployIdentityEnabled(process.env))
    try {
      return {
        gates: (
          await readDemoExternalGates({
            ...(input.now ? { now: input.now } : {}),
          })
        ).map((gate) => presentGeneratedGate(gate)),
        source: "Demonstration gate registry",
      };
    } catch {
      return failClosed(runtimeEnvironment);
    }
  if (!service) return failClosed(runtimeEnvironment);
  try {
    return {
      gates: (
        await service.list({
          requestId: input.requestId ?? `gate-page:${crypto.randomUUID()}`,
          now: input.now ?? new Date(),
        })
      ).map((gate) =>
        presentGeneratedGate({
          ...gate,
          blockedReasons: [...gate.blockedReasons],
          emergencyDisabledAt: gate.emergencyDisabledAt ?? null,
          emergencyDisabledBy: gate.emergencyDisabledBy ?? null,
          emergencyDisableReason: gate.emergencyDisableReason ?? null,
          emergencyDisableEvidenceReference:
            gate.emergencyDisableEvidenceReference ?? null,
        }),
      ),
      source: "System gate registry",
    };
  } catch {
    return failClosed(runtimeEnvironment);
  }
}
