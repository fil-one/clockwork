import "server-only";

import type { DatabaseExternalGateService } from "@clockwork/db";
import { findDemoProductionMarker } from "@clockwork/testing/demo-state";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

import {
  fallbackGates,
  type GateRecord,
} from "@/src/features/internal-ops/administration-safety/data";
import { presentGeneratedGate } from "@/src/features/internal-ops/administration-safety/gates";
import type { Translator } from "@/src/i18n";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { readDemoExternalGates } from "./demo-gate-state";

/**
 * Where the gate register's rows came from. These are keys the register reads
 * and names for the reader; they are not shown as written.
 */
export type GateRecordSource =
  | "System gate registry"
  | "Demonstration gate registry"
  | "Fail-closed operational fallback";

export interface GateRecordResult {
  gates: readonly GateRecord[];
  source: GateRecordSource;
}

/**
 * The single row shown when production cannot read the registry. `group`,
 * `severity` and `state` are the register's closed-set keys (it groups and
 * counts blockers by them); every sentence is in the reader's language.
 */
function unavailableRegistry(t: Translator): GateRecord {
  return {
    id: "SYSTEM-GATE-REGISTRY-UNAVAILABLE",
    group: "Operations", // i18n-exempt: closed-set key the gate register groups by
    title: t("operations.gates.unavailable.title"),
    owner: t("operations.gates.unavailable.owner"),
    capability: t("operations.gates.unavailable.capability"),
    activationTest: t("operations.gates.unavailable.activationTest"),
    severity: "Launch blocker", // i18n-exempt: closed-set key the gate register ranks by
    state: "Blocked", // i18n-exempt: closed-set key the gate register counts blockers by
    freshness: t("operations.gates.unavailable.freshness"),
    reason: t("operations.gates.unavailable.reason"),
  };
}

function failClosed(
  runtimeEnvironment: string,
  t: Translator,
): GateRecordResult {
  const allowDemoFallback =
    !findDemoProductionMarker(process.env) &&
    runtimeEnvironment.trim().toLowerCase() !== "production";
  return {
    gates: allowDemoFallback ? fallbackGates : [unavailableRegistry(t)],
    source: "Fail-closed operational fallback", // i18n-exempt: GateRecordSource key; the gate register names it
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
  const formattingLocale = await getFormattingLocale();
  const t = await getTranslations();
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
        ).map((gate) => presentGeneratedGate(gate, formattingLocale)),
        source: "Demonstration gate registry", // i18n-exempt: GateRecordSource key; the gate register names it
      };
    } catch {
      return failClosed(runtimeEnvironment, t);
    }
  if (!service) return failClosed(runtimeEnvironment, t);
  try {
    return {
      gates: (
        await service.list({
          requestId: input.requestId ?? `gate-page:${crypto.randomUUID()}`,
          now: input.now ?? new Date(),
        })
      ).map((gate) =>
        presentGeneratedGate(
          {
            ...gate,
            blockedReasons: [...gate.blockedReasons],
            emergencyDisabledAt: gate.emergencyDisabledAt ?? null,
            emergencyDisabledBy: gate.emergencyDisabledBy ?? null,
            emergencyDisableReason: gate.emergencyDisableReason ?? null,
            emergencyDisableEvidenceReference:
              gate.emergencyDisableEvidenceReference ?? null,
          },
          formattingLocale,
        ),
      ),
      source: "System gate registry", // i18n-exempt: GateRecordSource key; the gate register names it
    };
  } catch {
    return failClosed(runtimeEnvironment, t);
  }
}
