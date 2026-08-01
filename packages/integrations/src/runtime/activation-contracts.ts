import { z } from "zod";

import type { ProviderJsonTransport } from "../provider-transport";
import type {
  ProviderRuntimeEnvironment,
  ProviderRuntimeGateKey,
  ProviderRuntimeMode,
} from "./provider-runtime";

export interface ProviderActivationContract {
  gateKey: ProviderRuntimeGateKey;
  requiredExternalInputs: readonly string[];
  checks: readonly string[];
  runbook: string;
}

export const executableProviderActivationContracts = {
  "EXT-ACC-01": {
    gateKey: "EXT-ACC-01",
    requiredExternalInputs: [
      "named staging account/project identifiers",
      "least-privilege staging credentials installed by the secret manager",
      "credential rotation and restricted-role denial evidence",
    ],
    checks: [
      "bounded_authenticated_probe",
      "restricted_role_denial",
      "credential_rotation",
      "production_target_denial",
    ],
    runbook: "docs/operations/external-gate-activation.md",
  },
  "EXT-PROVIDER-01": {
    gateKey: "EXT-PROVIDER-01",
    requiredExternalInputs: [
      "approved provider selection and executed contract",
      "sandbox endpoint and scoped credential",
      "sender/webhook/account configuration evidence",
    ],
    checks: [
      "contract_success",
      "transient_and_permanent_failure",
      "idempotent_replay",
      "signed_callback",
      "production_target_denial",
    ],
    runbook: "docs/operations/webhook-replay.md",
  },
  "EXT-PROVISION-01": {
    gateKey: "EXT-PROVISION-01",
    requiredExternalInputs: [
      "authenticated provisioning and usage contract",
      "versioned SKU/entitlement mapping",
      "staging credential routing and recovery authority",
    ],
    checks: [
      "provision_once",
      "duplicate_noop",
      "crash_after_provider_success",
      "confirmation_binding",
      "source_usage_reconciliation",
      "production_target_denial",
    ],
    runbook: "docs/operations/stuck-provisioning.md",
  },
  "EXT-APPROVERS-01": {
    gateKey: "EXT-APPROVERS-01",
    requiredExternalInputs: [
      "persisted eligible primary and distinct backup roster",
      "approved separation-of-duties and absence escalation policy",
      "named reassignment authority and immutable evidence destination",
    ],
    checks: [
      "eligible_primary",
      "distinct_backup",
      "absence_escalation",
      "audited_reassignment",
      "separation_of_duties",
      "no_qualified_owner_denial",
      "production_target_denial",
    ],
    runbook: "docs/operations/external-gate-activation.md",
  },
  "EXT-TEARDOWN-01": {
    gateKey: "EXT-TEARDOWN-01",
    requiredExternalInputs: [
      "written product/security/legal authority",
      "approved scope and retention rules",
      "two distinct recently authenticated approvers",
    ],
    checks: [
      "automation_disabled_denial",
      "single_or_same_approver_denial",
      "retained_resource_denial",
      "provider_confirmation",
      "duplicate_noop",
      "production_target_denial",
    ],
    runbook: "docs/operations/offboarding.md",
  },
  "EXT-MARKETPLACE-01": {
    gateKey: "EXT-MARKETPLACE-01",
    requiredExternalInputs: [
      "marketplace enrollment and seller identifiers",
      "approved payout/tax profile and commercial authority",
      "staging/private-offer and settlement access",
    ],
    checks: [
      "private_offer_acceptance",
      "callback_replay",
      "metering",
      "settlement_tie_out",
      "missing_enrollment_denial",
      "production_target_denial",
    ],
    runbook: "docs/operations/billing-reconciliation.md",
  },
  "EXT-MIGRATION-01": {
    gateKey: "EXT-MIGRATION-01",
    requiredExternalInputs: [
      "immutable production source snapshot and access authority",
      "approved quiet window and customer communication timing",
      "named requester and two distinct approvers",
    ],
    checks: [
      "exact_snapshot_hash",
      "count_reconciliation",
      "crash_resume_and_dedupe",
      "rollback_boundary",
      "production_target_denial",
    ],
    runbook: "docs/operations/migration.md",
  },
} as const satisfies Record<ProviderRuntimeGateKey, ProviderActivationContract>;

export interface ProviderActivationProbeResult {
  evidenceKind: "live_staging" | "simulator";
  targetEnvironment: "staging" | "simulator";
  targetFingerprint: string;
  testedAt: string;
  testedBy: string;
  evidenceReference: string;
  passedChecks: readonly string[];
  details: string;
}

export interface ProviderActivationProbe {
  run(input: {
    gateKey: ProviderRuntimeGateKey;
    checks: readonly string[];
    requestId: string;
    timeoutMs: number;
  }): Promise<ProviderActivationProbeResult>;
}

export interface ExecutableProviderActivationResult extends ProviderActivationProbeResult {
  gateKey: ProviderRuntimeGateKey;
  activationEligible: boolean;
  missingChecks: readonly string[];
}

export class ExecutableProviderActivationRunner {
  public constructor(
    private readonly options: {
      environment: ProviderRuntimeEnvironment;
      mode: ProviderRuntimeMode;
      probe: ProviderActivationProbe;
      timeoutMs?: number;
    },
  ) {
    if (options.environment === "production" && options.mode !== "live")
      throw new Error("PRODUCTION_ACTIVATION_SIMULATOR_FORBIDDEN");
  }

  public async run(input: {
    gateKey: ProviderRuntimeGateKey;
    requestId: string;
  }): Promise<ExecutableProviderActivationResult> {
    const contract = executableProviderActivationContracts[input.gateKey];
    const result = await this.options.probe.run({
      gateKey: input.gateKey,
      checks: contract.checks,
      requestId: input.requestId,
      timeoutMs: this.options.timeoutMs ?? 10_000,
    });
    const passed = new Set(result.passedChecks);
    const missingChecks = contract.checks.filter((check) => !passed.has(check));
    const liveStaging =
      this.options.mode === "live" &&
      result.evidenceKind === "live_staging" &&
      result.targetEnvironment === "staging";
    return {
      ...result,
      gateKey: input.gateKey,
      activationEligible: liveStaging && missingChecks.length === 0,
      missingChecks,
    };
  }
}

const ProbeResponseSchema = z.object({
  evidenceKind: z.literal("live_staging"),
  targetEnvironment: z.literal("staging"),
  targetFingerprint: z.string().regex(/^[a-f0-9]{16,64}$/),
  testedAt: z.string().datetime({ offset: true }),
  testedBy: z.string().min(1).max(200),
  evidenceReference: z.string().min(8).max(1_000),
  passedChecks: z.array(z.string().min(1)).max(32),
  details: z.string().min(1).max(1_000),
});

/** Bounded live HTTP probe. Credentials remain inside the configured transport. */
export class HttpProviderActivationProbe implements ProviderActivationProbe {
  public constructor(private readonly transport: ProviderJsonTransport) {}

  public run(input: {
    gateKey: ProviderRuntimeGateKey;
    checks: readonly string[];
    requestId: string;
    timeoutMs: number;
  }): Promise<ProviderActivationProbeResult> {
    if (input.timeoutMs < 100 || input.timeoutMs > 30_000)
      throw new Error("ACTIVATION_PROBE_TIMEOUT_INVALID");
    return this.transport.request({
      operation: "provider.activation_contract",
      path: "/v1/activation-tests/run",
      body: {
        gateKey: input.gateKey,
        checks: input.checks,
        requestId: input.requestId,
        timeoutMs: input.timeoutMs,
        targetEnvironment: "staging",
      },
      response: ProbeResponseSchema,
      idempotencyKey: `activation:${input.gateKey}:${input.requestId}`,
    });
  }
}

/** Network-free contract fake. Its output is deliberately never activatable. */
export class DeterministicProviderActivationProbe implements ProviderActivationProbe {
  public constructor(
    environment: ProviderRuntimeEnvironment,
    private readonly testedAt = "2026-07-31T16:00:00.000Z",
  ) {
    if (environment === "production")
      throw new Error("PRODUCTION_ACTIVATION_SIMULATOR_FORBIDDEN");
  }

  public run(input: {
    gateKey: ProviderRuntimeGateKey;
    checks: readonly string[];
    requestId: string;
    timeoutMs: number;
  }): Promise<ProviderActivationProbeResult> {
    return Promise.resolve({
      evidenceKind: "simulator",
      targetEnvironment: "simulator",
      targetFingerprint: `sim-${input.gateKey.toLowerCase()}`,
      testedAt: this.testedAt,
      testedBy: "deterministic-provider-contract",
      evidenceReference: `urn:clockwork:simulator:${input.gateKey}:${encodeURIComponent(input.requestId)}`,
      passedChecks: [...input.checks],
      details: `${input.gateKey} deterministic scenarios passed; no live credentials, enrollment, approval, authority, or snapshot was asserted`,
    });
  }
}
