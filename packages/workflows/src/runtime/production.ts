import type { RuntimeDatabase, WorkflowExceptionRouting } from "@clockwork/db";
import {
  DatabaseCommercialArtifactStore,
  DatabaseCommissionStatementRepository,
  DatabaseCoreScheduleOccurrenceStore,
  DatabaseCoreWorkflowRecordPort,
  DatabaseDeletionCertificateStore,
  DatabaseExternalGateService,
  DatabaseOutboxDispatcherStore,
  DatabaseReportingDataPort,
  DatabaseSystemCapabilityGuard,
  DatabaseWorkosOrganizationProvisioningStore,
  DatabaseWorkflowExceptionPort,
  DatabaseWorkflowRunStore,
} from "@clockwork/db";
import type { ExternalCapability } from "@clockwork/domain/system";
import type {
  EvidenceStoragePort,
  RuntimeBoundaryInstrumentation,
  WorkosIdentityPort,
} from "@clockwork/integrations";
import {
  createCommercialArtifactOutboxHandler,
  type CommercialArtifactParty,
  type CommercialArtifactRenderer,
} from "../core/commercial-artifact-handler";
import { CoreFinanceWorkflowEngine } from "../core/engine";
import type {
  CoreCapabilityGuard,
  CoreCapabilityKey,
  CoreWorkflowDependencies,
} from "../core/ports";
import { configureCoreScheduleOccurrenceStore } from "../core/scheduled-runtime";
import { configureCoreFinanceWorkflowEngine } from "../core/task-runtime";
import { lifecycleWorkflowRegistry } from "../lifecycle";
import {
  configureLifecycleTaskRuntime,
  type LifecycleTaskRuntime,
} from "../onboarding/trigger-runtime";
import {
  createDeletionCertificateOutboxHandler,
  type DeletionCertificateBrand,
  type DeletionCertificateLocale,
  type DeletionCertificateParty,
  type DeletionCertificateRenderer,
} from "../offboarding/deletion-certificate-handler";
import {
  configureOutboxDispatcher,
  DurableOutboxDispatcher,
  type OutboxTopicHandler,
} from "../system/outbox-dispatcher";
import { createWorkosOrganizationOutboxHandler } from "../system/workos-organization";
import {
  configureExternalGateActivationExecutor,
  type ExternalGateActivationExecutor,
} from "../system/gate-activation-tasks";
import {
  DatabaseLifecycleTaskRuntime,
  type LifecycleTaskHandler,
} from "./database-lifecycle";

export interface ProductionWorkflowRuntimeInput {
  db: RuntimeDatabase;
  coreProviders: Pick<
    CoreWorkflowDependencies,
    | "billing"
    | "metering"
    | "accounting"
    | "commissionAccounting"
    | "notifications"
    | "usage"
    | "exports"
  >;
  exceptionRouting: WorkflowExceptionRouting;
  lifecycleHandlers: ReadonlyMap<string, LifecycleTaskHandler>;
  outboxHandlers: ReadonlyMap<string, OutboxTopicHandler>;
  workosIdentity: WorkosIdentityPort;
  deletionCertificates?: {
    evidence: EvidenceStoragePort;
    issuer: DeletionCertificateParty;
    brand?: DeletionCertificateBrand;
    locale?: DeletionCertificateLocale;
    automatedTeardownEnabled: boolean;
    renderer: DeletionCertificateRenderer;
  };
  commercialArtifacts?: {
    evidence: EvidenceStoragePort;
    platformIssuer: CommercialArtifactParty;
    renderer: CommercialArtifactRenderer;
  };
  clock?: () => Date;
  leaseMs?: number;
  gateActivationExecutor?: ExternalGateActivationExecutor;
  instrumentation?: RuntimeBoundaryInstrumentation;
}

const coreExternalCapability: Readonly<
  Record<CoreCapabilityKey, ExternalCapability>
> = {
  new_business: "new_business",
  legal: "legal_execution",
  billing: "provisioning_invoicing",
  partner: "partner",
  marketplace: "marketplace",
  teardown: "teardown",
};

/** Both software capability and external-input truth are required per attempt. */
class ProductionCoreCapabilityGuard implements CoreCapabilityGuard {
  private readonly internal: DatabaseSystemCapabilityGuard;
  private readonly external: DatabaseExternalGateService;

  public constructor(
    database: RuntimeDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.internal = new DatabaseSystemCapabilityGuard(database);
    this.external = new DatabaseExternalGateService(database);
  }

  public async require(input: {
    capabilities: readonly CoreCapabilityKey[];
    recovery: boolean;
    requestId: string;
  }) {
    const internal = await this.internal.require(input);
    const denied = new Set<CoreCapabilityKey>(internal.disabled);
    for (const capability of input.capabilities) {
      try {
        await this.external.requireCapability({
          capability: coreExternalCapability[capability],
          boundary: "provider_effect",
          effectIntent: "external_effect",
          requestId: `${input.requestId}:external:${capability}`,
          now: this.clock(),
        });
      } catch {
        denied.add(capability);
      }
    }
    const disabled = [...denied].sort();
    return { allowed: disabled.length === 0, disabled };
  }
}

function requireConfigured(value: unknown, name: string): void {
  if (!value) throw new Error(`WORKFLOW_PROVIDER_NOT_CONFIGURED:${name}`);
}

/**
 * Production composition only. Every provider is injected explicitly and this
 * module deliberately has no dependency on test fakes or in-memory stores.
 */
export function createProductionWorkflowRuntime(
  input: ProductionWorkflowRuntimeInput,
): {
  core: CoreFinanceWorkflowEngine;
  lifecycle: LifecycleTaskRuntime;
  outbox: DurableOutboxDispatcher;
  schedules: DatabaseCoreScheduleOccurrenceStore;
  activate(): void;
} {
  requireConfigured(input.db, "database");
  requireConfigured(input.exceptionRouting, "exception_routing");
  for (const name of [
    "billing",
    "metering",
    "accounting",
    "commissionAccounting",
    "notifications",
    "usage",
    "exports",
  ] as const)
    requireConfigured(input.coreProviders[name], name);
  const missingLifecycleHandlers = lifecycleWorkflowRegistry.filter(
    (taskId) => !input.lifecycleHandlers.has(taskId),
  );
  if (missingLifecycleHandlers.length > 0)
    throw new Error(
      `WORKFLOW_PROVIDER_NOT_CONFIGURED:lifecycle:${missingLifecycleHandlers.join(",")}`,
    );
  requireConfigured(input.workosIdentity, "workos_identity");
  const outboxHandlers = new Map(input.outboxHandlers);
  if (outboxHandlers.has("organization.created"))
    throw new Error("WORKFLOW_PROVIDER_DUPLICATE:organization.created");
  outboxHandlers.set(
    "organization.created",
    createWorkosOrganizationOutboxHandler({
      identity: input.workosIdentity,
      store: new DatabaseWorkosOrganizationProvisioningStore(input.db),
    }),
  );
  if (input.deletionCertificates) {
    const topic = "termination.deletion_certificate_requested";
    if (outboxHandlers.has(topic))
      throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${topic}`);
    outboxHandlers.set(
      topic,
      createDeletionCertificateOutboxHandler({
        ...input.deletionCertificates,
        persistence: new DatabaseDeletionCertificateStore(input.db),
      }),
    );
  }
  if (input.commercialArtifacts) {
    const topic = "commerce.commercial_artifact_requested";
    if (outboxHandlers.has(topic))
      throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${topic}`);
    outboxHandlers.set(
      topic,
      createCommercialArtifactOutboxHandler({
        ...input.commercialArtifacts,
        persistence: new DatabaseCommercialArtifactStore(input.db),
      }),
    );
  }

  const runs = new DatabaseWorkflowRunStore(input.db, {
    ...(input.clock ? { clock: input.clock } : {}),
    ...(input.leaseMs ? { leaseMs: input.leaseMs } : {}),
  });
  const exceptions = new DatabaseWorkflowExceptionPort(
    input.db,
    input.exceptionRouting,
  );
  const records = new DatabaseCoreWorkflowRecordPort(input.db);
  const commissionStatements = new DatabaseCommissionStatementRepository(
    input.db,
  );
  const reporting = new DatabaseReportingDataPort(input.db);
  const dependencies: CoreWorkflowDependencies = {
    capabilities: new ProductionCoreCapabilityGuard(input.db, input.clock),
    runs,
    exceptions,
    records,
    reporting,
    commissionSettlements: {
      validate: (settlement) =>
        commissionStatements.validateSettlement(settlement),
      finalize: (settlement) =>
        commissionStatements.finalizeSettlement({
          ...settlement,
          actor: { kind: "system", id: "commission-settlement-workflow" },
        }),
    },
    ...input.coreProviders,
  };
  const core = new CoreFinanceWorkflowEngine(dependencies);
  const schedules = new DatabaseCoreScheduleOccurrenceStore(input.db);
  const lifecycle = new DatabaseLifecycleTaskRuntime(
    runs,
    input.lifecycleHandlers,
    input.clock,
  );
  const outbox = new DurableOutboxDispatcher(
    new DatabaseOutboxDispatcherStore(input.db, {
      ...(input.clock ? { clock: input.clock } : {}),
      ...(input.leaseMs ? { leaseMs: input.leaseMs } : {}),
    }),
    outboxHandlers,
    input.instrumentation,
  );
  return {
    core,
    lifecycle,
    outbox,
    schedules,
    activate() {
      configureCoreFinanceWorkflowEngine(core, input.instrumentation);
      configureCoreScheduleOccurrenceStore(schedules);
      configureLifecycleTaskRuntime(lifecycle, input.instrumentation);
      configureOutboxDispatcher(outbox);
      if (input.gateActivationExecutor)
        configureExternalGateActivationExecutor(input.gateActivationExecutor);
    },
  };
}
