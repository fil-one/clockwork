import "server-only";

import {
  assertExternalGateTransition,
  evaluateExternalGate,
  externalGateActivationTestIsCurrent,
  externalGateRequiresLiveSignedInput,
  ExternalGateKeySchema,
  type ExternalGateConfiguredStatus,
  type ExternalGateKey,
  type ExternalGateRecord,
  type ExternalGateView,
} from "@clockwork/domain/system";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import { demoUuid } from "@/src/features/experience-server/demo-artifact-catalog";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { fallbackGates } from "@/src/features/internal-ops/administration-safety/data";

const seededAt = "2026-07-31T16:00:00.000Z";
const prefix = "demo-external-gate:";

export type DemoExternalGateView = ExternalGateView & {
  readonly blockedReasons: string[];
  readonly emergencyDisabledAt: string | null;
  readonly emergencyDisabledBy: string | null;
  readonly emergencyDisableReason: string | null;
  readonly emergencyDisableEvidenceReference: string | null;
};

function view(record: ExternalGateRecord, now: Date): DemoExternalGateView {
  const evaluated = evaluateExternalGate(record, now);
  return {
    ...evaluated,
    blockedReasons: [...evaluated.blockedReasons],
    emergencyDisabledAt: evaluated.emergencyDisabledAt ?? null,
    emergencyDisabledBy: evaluated.emergencyDisabledBy ?? null,
    emergencyDisableReason: evaluated.emergencyDisableReason ?? null,
    emergencyDisableEvidenceReference:
      evaluated.emergencyDisableEvidenceReference ?? null,
  };
}

function configuredStatus(
  value: string | undefined,
): ExternalGateConfiguredStatus {
  return value === "active" ||
    value === "review" ||
    value === "pending" ||
    value === "not_required"
    ? value
    : "blocked";
}

const demoGates: readonly ExternalGateRecord[] = fallbackGates.map((gate) => ({
  id: demoUuid(`external-gate:${gate.id}`),
  gateKey: ExternalGateKeySchema.parse(gate.id),
  title: gate.title,
  owner: gate.owner,
  inputRequired: gate.inputRequired ?? gate.technicalEvidence ?? gate.reason,
  affectedFeature: gate.capability,
  severity: gate.severity.toLowerCase().replaceAll(" ", "_"),
  configuredStatus: configuredStatus(gate.configuredState),
  simulatorState: "ready",
  simulatorDetails: gate.activationTest,
  inputProvenance: "repository_fixture",
  lastActivationTestStatus: "never",
  lastActivationTestAt: null,
  lastActivationTestedBy: null,
  activationEvidenceReference: null,
  reviewOn: gate.reviewOn ?? "2026-12-31",
  statusReason: gate.reason,
  emergencyDisabledAt: null,
  emergencyDisabledBy: null,
  emergencyDisableReason: null,
  emergencyDisableEvidenceReference: null,
  rowVersion: 1,
  updatedAt: seededAt,
}));

function storedRecord(
  state: DemoAdapterState,
  seed: ExternalGateRecord,
): ExternalGateRecord {
  const data = state.projectionOverrides[`${prefix}${seed.gateKey}`]?.data;
  if (data?.kind !== "external_gate" || !data.record) return seed;
  if (typeof data.record !== "object" || Array.isArray(data.record))
    // i18n-exempt: an invariant on stored demo state; the loader catches it and fails closed
    throw new Error("Demo external-gate state is invalid");
  return data.record as unknown as ExternalGateRecord;
}

function persist(
  state: DemoAdapterState,
  record: ExternalGateRecord,
): DemoAdapterState {
  const key = `${prefix}${record.gateKey}`;
  return {
    ...state,
    revision: state.revision + 1,
    projectionOverrides: {
      ...state.projectionOverrides,
      [key]: {
        version: record.rowVersion,
        updatedAt: record.updatedAt,
        data: { kind: "external_gate", record },
      },
    },
  };
}

export async function readDemoExternalGates(
  input: {
    now?: Date;
    store?: DemoAdapterStateStore;
  } = {},
): Promise<readonly DemoExternalGateView[]> {
  const state = await (input.store ?? configuredDemoStateStore()).read();
  const now = input.now ?? new Date();
  return demoGates.map((gate) => view(storedRecord(state, gate), now));
}

export async function updateDemoExternalGateState(input: {
  gateKey: ExternalGateKey;
  expectedRowVersion: number;
  owner: string;
  inputRequired: string;
  configuredStatus: ExternalGateConfiguredStatus;
  reviewOn: string | null;
  statusReason: string;
  now?: Date;
  store?: DemoAdapterStateStore;
}): Promise<DemoExternalGateView> {
  const seed = demoGates.find((gate) => gate.gateKey === input.gateKey);
  if (!seed) throw new Error("EXTERNAL_GATE_NOT_FOUND");
  const store = input.store ?? configuredDemoStateStore();
  const now = input.now ?? new Date();
  let result: DemoExternalGateView | undefined;
  await store.update((state) => {
    const existing = storedRecord(state, seed);
    if (existing.rowVersion !== input.expectedRowVersion)
      throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
    const updated: ExternalGateRecord = {
      ...existing,
      owner: input.owner.trim(),
      inputRequired: input.inputRequired.trim(),
      configuredStatus: input.configuredStatus,
      reviewOn: input.reviewOn,
      statusReason: input.statusReason.trim(),
      rowVersion: existing.rowVersion + 1,
      updatedAt: now.toISOString(),
    };
    assertExternalGateTransition(updated, now);
    result = view(updated, now);
    return persist(state, updated);
  });
  if (!result) throw new Error("EXTERNAL_GATE_UPDATE_FAILED");
  return result;
}

export async function testDemoExternalGateState(input: {
  gateKey: ExternalGateKey;
  expectedRowVersion: number;
  actorId: string;
  now?: Date;
  store?: DemoAdapterStateStore;
}): Promise<DemoExternalGateView> {
  const seed = demoGates.find((gate) => gate.gateKey === input.gateKey);
  if (!seed) throw new Error("EXTERNAL_GATE_NOT_FOUND");
  const store = input.store ?? configuredDemoStateStore();
  const now = input.now ?? new Date();
  let result: DemoExternalGateView | undefined;
  await store.update((state) => {
    const existing = storedRecord(state, seed);
    if (existing.rowVersion !== input.expectedRowVersion)
      throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
    const testedAt = now.toISOString();
    const testAllowsActivation =
      existing.simulatorState === "ready" &&
      (!externalGateRequiresLiveSignedInput(existing.gateKey) ||
        existing.inputProvenance === "live_signed") &&
      externalGateActivationTestIsCurrent(testedAt, now);
    const updated: ExternalGateRecord = {
      ...existing,
      configuredStatus:
        existing.configuredStatus === "active" && !testAllowsActivation
          ? "blocked"
          : existing.configuredStatus,
      lastActivationTestStatus: "passed",
      lastActivationTestAt: testedAt,
      lastActivationTestedBy: input.actorId,
      activationEvidenceReference: `demo-suite:${existing.gateKey}:${testedAt}`,
      rowVersion: existing.rowVersion + 1,
      updatedAt: testedAt,
    };
    result = view(updated, now);
    return persist(state, updated);
  });
  if (!result) throw new Error("EXTERNAL_GATE_TEST_FAILED");
  return result;
}
