import type { SystemCapabilityKey } from "@clockwork/db";
import {
  externalCapabilityGateMatrix,
  type ExternalGateKey,
} from "@clockwork/domain/system";

export const workflowProviderNames = [
  "billing",
  "accounting",
  "notifications",
  "usage",
  "workos",
  "evidence",
  "provisioning",
  "screening",
  "signature",
  "tax",
] as const;
export type WorkflowProviderName = (typeof workflowProviderNames)[number];
export interface WorkflowCapabilityProfile {
  capabilities: readonly SystemCapabilityKey[];
  providers: readonly WorkflowProviderName[];
  gateKeys: readonly ExternalGateKey[];
  artifacts: boolean;
}

const requiredProviders: Record<
  SystemCapabilityKey,
  readonly WorkflowProviderName[]
> = {
  new_business: ["workos", "screening", "notifications", "evidence"],
  legal: ["signature", "notifications", "evidence"],
  billing: [
    "billing",
    "accounting",
    "usage",
    "provisioning",
    "notifications",
    "evidence",
    "tax",
  ],
  partner: workflowProviderNames,
  marketplace: workflowProviderNames,
  teardown: ["usage", "provisioning", "notifications", "evidence"],
};
const capabilityExternal = {
  new_business: "new_business",
  legal: "legal_execution",
  billing: "provisioning_invoicing",
  partner: "partner",
  marketplace: "marketplace",
  teardown: "teardown",
} as const;
const providerGates: Record<WorkflowProviderName, ExternalGateKey> = {
  billing: "EXT-ACC-01",
  accounting: "EXT-PROVIDER-01",
  notifications: "EXT-PROVIDER-01",
  usage: "EXT-PROVISION-01",
  workos: "EXT-ACC-01",
  evidence: "EXT-ACC-01",
  provisioning: "EXT-PROVISION-01",
  screening: "EXT-PROVIDER-01",
  signature: "EXT-LEGAL-01",
  tax: "EXT-TAX-01",
};

/** Recovery can need a provider even when new work is switched off. Missing rows are disabled. */
export function deriveWorkflowCapabilityProfile(
  rows: readonly {
    capabilityKey: string;
    enabled: boolean;
    recoveryEnabled: boolean;
  }[],
): WorkflowCapabilityProfile {
  const capabilities = rows
    .filter((row) => row.enabled || row.recoveryEnabled)
    .map((row) => {
      if (!Object.hasOwn(requiredProviders, row.capabilityKey))
        throw new Error("WORKFLOW_CAPABILITY_KEY_INVALID");
      return row.capabilityKey as SystemCapabilityKey;
    });
  const providers = [
    ...new Set(capabilities.flatMap((key) => requiredProviders[key])),
  ].sort();
  const gateKeys = [
    ...new Set<ExternalGateKey>([
      ...providers.map((name) => providerGates[name]),
      ...capabilities.flatMap(
        (key) => externalCapabilityGateMatrix[capabilityExternal[key]],
      ),
      ...(capabilities.length ? ["EXT-APPROVERS-01" as const] : []),
    ]),
  ].sort();
  return {
    capabilities,
    providers,
    gateKeys,
    artifacts: capabilities.length > 0,
  };
}

/**
 * An omitted provider is an explicit denial port, never a successful simulator.
 * Nested ports remain typed by their consumer; every method throws before IO.
 * `then` is absent so Promise resolution cannot mistake this port for a promise.
 */
export function disabledWorkflowProvider<T>(name: string): T {
  const deny = () => {
    throw new Error(
      `WORKFLOW_PROVIDER_DISABLED:${name}:restart_after_activation`,
    );
  };
  const port: unknown = new Proxy(deny, {
    get: (_target, property): unknown =>
      property === "then"
        ? undefined
        : disabledWorkflowProvider<unknown>(`${name}.${String(property)}`),
    apply: deny,
  });
  return port as T;
}
