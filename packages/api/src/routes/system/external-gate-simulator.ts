import {
  externalGateKeys,
  type ActivationTestRunner,
  type ExternalGateActivationTestResult,
  type ExternalGateKey,
} from "@clockwork/domain/system";

export const deterministicExternalGateActivationSuites = {
  "EXT-ACC-01": "hosted-account credential, MFA, and signed-callback suite",
  "EXT-LEGAL-01": "legal-byte hash, threshold, and jurisdiction suite",
  "EXT-COMMERCIAL-01": "golden-quote and commitment-model suite",
  "EXT-PROVIDER-01": "provider contract, signature, and posting suite",
  "EXT-PROVISION-01": "provisioning, replay, conversion, and teardown suite",
  "EXT-TAX-01": "tax, accounting, and reconciliation matrix",
  "EXT-DOMAIN-01": "DNS, TLS, redirect, CSRF, and sender-auth suite",
  "EXT-BRAND-01": "responsive, PDF, fallback, and accessibility suite",
  "EXT-APPROVERS-01": "absence, separation, and escalation drill",
  "EXT-TEARDOWN-01": "two-person retained-object teardown suite",
  "EXT-MARKETPLACE-01": "marketplace order and settlement replay suite",
  "EXT-MIGRATION-01": "snapshot rehearsal, resume, and rollback suite",
} as const satisfies Record<ExternalGateKey, string>;

export interface DeterministicActivationTestOutcome {
  status: "passed" | "failed";
  simulatorState: "ready" | "degraded" | "unavailable";
}

/** Network-free simulator. A production composition must inject a live runner instead. */
export class DeterministicExternalGateActivationTestRunner implements ActivationTestRunner {
  public constructor(
    private readonly outcomes: Partial<
      Record<ExternalGateKey, DeterministicActivationTestOutcome>
    > = {},
  ) {}

  public run(
    input: Parameters<ActivationTestRunner["run"]>[0],
  ): Promise<ExternalGateActivationTestResult> {
    const suite = deterministicExternalGateActivationSuites[input.gate.gateKey];
    const outcome = this.outcomes[input.gate.gateKey] ?? {
      status: "passed",
      simulatorState: "ready",
    };
    return Promise.resolve({
      status: outcome.status,
      testedAt: input.requestedAt.toISOString(),
      testedBy: `deterministic-runner:${input.actor.id}`,
      evidenceReference: `evidence://activation-tests/${input.gate.gateKey.toLowerCase()}/${encodeURIComponent(input.requestId)}`,
      simulatorState: outcome.simulatorState,
      simulatorDetails: `${suite}: ${outcome.status}; simulator ${outcome.simulatorState}`,
    });
  }
}

export function createExternalGateActivationSimulator(input: {
  enabled: boolean;
  runtimeEnvironment: string | undefined;
  outcomes?: Partial<
    Record<ExternalGateKey, DeterministicActivationTestOutcome>
  >;
}): ActivationTestRunner | undefined {
  if (
    !input.enabled ||
    !["development", "test"].includes(input.runtimeEnvironment ?? "")
  )
    return undefined;
  return new DeterministicExternalGateActivationTestRunner(input.outcomes);
}

if (
  Object.keys(deterministicExternalGateActivationSuites).length !==
  externalGateKeys.length
)
  throw new Error(
    "Every external gate must have a deterministic activation suite",
  );
