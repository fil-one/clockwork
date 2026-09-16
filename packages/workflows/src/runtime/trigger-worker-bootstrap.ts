import { createRuntimeDatabase, type RuntimeDatabase } from "@clockwork/db";

import {
  activateWorkflowRuntime,
  createWorkflowRuntime,
  resetWorkflowRuntimeBootstrapForTests,
  WorkflowBootstrapConfigurationError,
  workflowRuntimeStatus,
  type ActivatableWorkflowRuntime,
  type ProductionWorkflowAdapterFactory,
  type ProductionWorkflowRuntime,
  type WorkflowRuntimeEnvironment,
} from "./workflow-runtime";

export {
  activateWorkflowRuntime,
  createWorkflowRuntime,
  resetWorkflowRuntimeBootstrapForTests,
  validateWorkflowRuntimeEnvironment,
  WorkflowBootstrapConfigurationError,
  workflowRuntimeStatus,
  type ActivatableWorkflowRuntime,
  type CreateWorkflowRuntimeInput,
  type ProductionWorkflowAdapterBundle,
  type ProductionWorkflowAdapterFactory,
  type ProductionWorkflowRuntime,
  type WorkflowRuntimeEnvironment,
  type WorkflowRuntimeEnvironmentSource,
} from "./workflow-runtime";

/**
 * The Trigger.dev worker's entry point: the environment it alone requires, and
 * its own database connection. Everything past that is
 * `createWorkflowRuntime`, which the SQS host reaches by the same route.
 */
export const productionWorkflowExternalInputs = [
  {
    component: "trigger_worker",
    gate: "EXT-ACC-01",
    input: "Trigger.dev project reference and environment secret",
  },
  {
    component: "database",
    gate: "EXT-ACC-01",
    input: "direct clockwork_service database URL",
  },
  {
    component: "billing_metering",
    gate: "EXT-ACC-01",
    input: "activated Stripe account and scoped secret key",
  },
  {
    component: "commercial_policy",
    gate: "EXT-COMMERCIAL-01",
    input:
      "signed SKU, currency, minimum, overage, floor, partner-tier, credit, and claims inputs",
  },
  {
    component: "accounting",
    gate: "EXT-PROVIDER-01",
    input: "selected QBO connector, posting model, and credentials",
  },
  {
    component: "notifications",
    gate: "EXT-PROVIDER-01",
    input:
      "selected transactional notification provider and sender credentials",
  },
  {
    component: "crm",
    gate: "EXT-PROVIDER-01",
    input:
      "selected CRM endpoint, scoped credentials, and approved one-way object mapping (CRM_PROVIDER_BASE_URL, CRM_PROVIDER_TOKEN)",
  },
  {
    component: "screening",
    gate: "EXT-PROVIDER-01",
    input:
      "selected denied-party screening endpoint, contract, and scoped credentials",
  },
  {
    component: "signature",
    gate: "EXT-LEGAL-01",
    input:
      "selected signature endpoint, scoped credentials, and signing-origin allow-list",
  },
  {
    component: "document_renderer",
    gate: "EXT-PROVIDER-01",
    input:
      "authenticated immutable PDF renderer endpoint and scoped credentials",
  },
  {
    component: "usage_lifecycle",
    gate: "EXT-PROVISION-01",
    input:
      "product usage/provisioning API and authenticated lifecycle contract",
  },
  {
    component: "workos_identity",
    gate: "EXT-ACC-01",
    input:
      "WorkOS organization-management credentials and MFA policy configuration",
  },
  {
    component: "evidence",
    gate: "EXT-ACC-01",
    input:
      "Object Lock evidence bucket, KMS key, malware scanner, and scoped credentials",
  },
  {
    component: "exception_routing",
    gate: "EXT-APPROVERS-01",
    input:
      "named queue owners, distinct backups, targets, and escalation roster",
  },
  {
    component: "legal_artifact_identity",
    gate: "EXT-LEGAL-01",
    input: "approved platform issuer identity and artifact rules",
  },
  {
    component: "tax_accounting_policy",
    gate: "EXT-TAX-01",
    input:
      "signed registrations, exemption rules, invoice entities, QBO mappings, revenue recognition, and credit policy",
  },
  {
    component: "tax_engine",
    gate: "EXT-TAX-01",
    input:
      "selected tax determination endpoint and scoped credentials (TAX_PROVIDER_BASE_URL, TAX_PROVIDER_TOKEN)",
  },
] as const;

export const productionWorkflowInternalCompositionGaps = [] as const;
export interface TriggerWorkerEnvironment extends WorkflowRuntimeEnvironment {
  directDatabaseUrl: string;
  triggerProjectRef: string;
  triggerSecretKey: string;
}

export type TriggerWorkerEnvironmentSource = Readonly<
  Record<string, string | undefined>
>;

function required(
  source: TriggerWorkerEnvironmentSource,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value)
    throw new WorkflowBootstrapConfigurationError([name], ["EXT-ACC-01"]);
  return value;
}

export function validateTriggerWorkerEnvironment(
  source: TriggerWorkerEnvironmentSource,
): TriggerWorkerEnvironment {
  const runtimeEnvironment = required(source, "NODE_ENV");
  if (!["development", "test", "production"].includes(runtimeEnvironment))
    throw new WorkflowBootstrapConfigurationError(["NODE_ENV"], ["EXT-ACC-01"]);
  const directDatabaseUrl = required(source, "DIRECT_DATABASE_URL");
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(directDatabaseUrl);
  } catch {
    throw new WorkflowBootstrapConfigurationError(
      ["DIRECT_DATABASE_URL"],
      ["EXT-ACC-01"],
    );
  }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol))
    throw new WorkflowBootstrapConfigurationError(
      ["DIRECT_DATABASE_URL"],
      ["EXT-ACC-01"],
    );
  if (
    runtimeEnvironment === "production" &&
    ["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)
  )
    throw new WorkflowBootstrapConfigurationError(
      ["DIRECT_DATABASE_URL:production_target_required"],
      ["EXT-ACC-01"],
    );
  const triggerProjectRef = required(source, "TRIGGER_PROJECT_REF");
  if (!/^proj_[A-Za-z0-9_-]+$/.test(triggerProjectRef))
    throw new WorkflowBootstrapConfigurationError(
      ["TRIGGER_PROJECT_REF"],
      ["EXT-ACC-01"],
    );
  const triggerSecretKey = required(source, "TRIGGER_SECRET_KEY");
  if (!triggerSecretKey.startsWith("tr_") || triggerSecretKey.length < 16)
    throw new WorkflowBootstrapConfigurationError(
      ["TRIGGER_SECRET_KEY"],
      ["EXT-ACC-01"],
    );
  return {
    runtimeEnvironment:
      runtimeEnvironment as TriggerWorkerEnvironment["runtimeEnvironment"],
    directDatabaseUrl,
    triggerProjectRef,
    triggerSecretKey,
  };
}
/**
 * The worker opens its own direct connection -- no pooler in front of it, so a
 * transaction survives a long provider call -- and hands it to the neutral
 * bootstrap. A failure closes the client rather than leaving the pool open
 * behind a process that will not serve.
 */
export async function createEnvironmentProductionWorkflowRuntime(
  input: {
    source?: TriggerWorkerEnvironmentSource;
    adapterFactory?: ProductionWorkflowAdapterFactory;
    readCapabilities?: (db: RuntimeDatabase) => Promise<
      readonly {
        capabilityKey: string;
        enabled: boolean;
        recoveryEnabled: boolean;
      }[]
    >;
  } = {},
): Promise<ProductionWorkflowRuntime> {
  const source = input.source ?? process.env;
  const environment = validateTriggerWorkerEnvironment(source);
  const { client, db } = createRuntimeDatabase({
    url: environment.directDatabaseUrl,
    role: "clockwork_service",
  });
  try {
    return await createWorkflowRuntime({
      db,
      source,
      ...(input.adapterFactory ? { adapterFactory: input.adapterFactory } : {}),
      ...(input.readCapabilities
        ? { readCapabilities: input.readCapabilities }
        : {}),
    });
  } catch (error) {
    await client.end();
    throw error;
  }
}

export function triggerWorkerBootstrapStatus():
  "inactive" | "activating" | "active" {
  return workflowRuntimeStatus();
}

export function activateTriggerWorkerRuntime(
  load: () => Promise<ActivatableWorkflowRuntime> = () =>
    createEnvironmentProductionWorkflowRuntime(),
): Promise<ActivatableWorkflowRuntime> {
  return activateWorkflowRuntime(load);
}

export function resetTriggerWorkerBootstrapForTests(): void {
  resetWorkflowRuntimeBootstrapForTests();
}
