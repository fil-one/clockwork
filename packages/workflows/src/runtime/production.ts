import type { RuntimeDatabase, WorkflowExceptionRouting } from "@clockwork/db";
import {
  DatabaseCommercialArtifactStore,
  DatabaseCoreWorkflowRecordPort,
  DatabaseDeletionCertificateStore,
  DatabaseOutboxDispatcherStore,
  DatabaseReportingDataPort,
  DatabaseWorkosOrganizationProvisioningStore,
  DatabaseWorkflowExceptionPort,
  DatabaseWorkflowRunStore,
} from "@clockwork/db";
import type {
  EvidenceStoragePort,
  WorkosIdentityPort,
} from "@clockwork/integrations";
import {
  createCommercialArtifactOutboxHandler,
  type CommercialArtifactParty,
  type CommercialArtifactRenderer,
} from "../core/commercial-artifact-handler";
import { CoreFinanceWorkflowEngine } from "../core/engine";
import type { CoreWorkflowDependencies } from "../core/ports";
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
  activate(): void;
} {
  requireConfigured(input.db, "database");
  requireConfigured(input.exceptionRouting, "exception_routing");
  for (const name of [
    "billing",
    "metering",
    "accounting",
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
  const reporting = new DatabaseReportingDataPort(input.db);
  const dependencies: CoreWorkflowDependencies = {
    runs,
    exceptions,
    records,
    reporting,
    ...input.coreProviders,
  };
  const core = new CoreFinanceWorkflowEngine(dependencies);
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
  );
  return {
    core,
    lifecycle,
    outbox,
    activate() {
      configureCoreFinanceWorkflowEngine(core);
      configureLifecycleTaskRuntime(lifecycle);
      configureOutboxDispatcher(outbox);
    },
  };
}
