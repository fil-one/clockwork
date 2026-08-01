import type {
  BillingPort,
  EvidenceStoragePort as CoreEvidenceStoragePort,
  ProvisioningPort,
} from "@clockwork/contracts";
import {
  DatabaseAuthoritativeLifecycleTaskStore,
  DatabaseExternalGateService,
  DatabaseQboVendorMappingResolver,
  DatabaseProvisioningDispatchStore,
  type RuntimeDatabase,
  type WorkflowExceptionRouting,
} from "@clockwork/db";
import {
  externalGateActivationTestIsCurrent,
  sanitizeActivationEvidenceReference,
  type ExternalGateActivationTestResult,
  type ExternalGateKey,
} from "@clockwork/domain/system";
import {
  CoreNotificationAdapter,
  OrchestratorUsageAdapter,
  QboNeutralAccountingAdapter,
  WorkosIdentityAdapter,
  type AccountingExportSink,
  type EvidenceStoragePort as LifecycleEvidenceStoragePort,
  type NotificationProviderClient,
  type StripeLedgerBillingPort,
  type StripeCommercialGateway,
  type UsageProviderClient,
  type WorkosClient,
} from "@clockwork/integrations";

import type {
  CommercialArtifactParty,
  CommercialArtifactRenderer,
} from "../core/commercial-artifact-handler";
import { createCoreScheduledOutboxHandler } from "../core/scheduled-outbox-handler";
import { createStripeAdjustmentOutboxHandlers } from "../core/stripe-adjustment-handler";
import {
  createCoreWorkflowOutboxHandlers,
  type CoreWorkflowTaskSubmitter,
} from "../core/outbox-handlers";
import type {
  DeletionCertificateBrand,
  DeletionCertificateLocale,
  DeletionCertificateParty,
  DeletionCertificateRenderer,
} from "../offboarding/deletion-certificate-handler";
import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import { createLifecycleTaskOutboxHandlers } from "../system/lifecycle-task-dispatch";
import type {
  ProductionWorkflowAdapterBundle,
  ProductionWorkflowAdapterFactory,
} from "./trigger-worker-bootstrap";
import { createAuthoritativeLifecycleHandlers } from "./provider-lifecycle";

export type ProviderAdapterMode = "live" | "simulator";

export interface SelectedProvider<T> {
  mode: ProviderAdapterMode;
  value: T;
  activationTest(): Promise<ExternalGateActivationTestResult>;
}

export interface WorkflowProviderActivationGuard {
  requireActive(
    gateKeys: readonly ExternalGateKey[],
    requestId: string,
  ): Promise<void>;
}

export class PersistedWorkflowProviderActivationGuard implements WorkflowProviderActivationGuard {
  private readonly gates: DatabaseExternalGateService;

  public constructor(
    database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.gates = new DatabaseExternalGateService(database);
  }

  public async requireActive(
    gateKeys: readonly ExternalGateKey[],
    requestId: string,
  ): Promise<void> {
    let views: Awaited<ReturnType<DatabaseExternalGateService["list"]>>;
    try {
      views = await this.gates.list({ requestId, now: this.now() });
    } catch {
      throw new Error("WORKFLOW_EXTERNAL_GATE_REGISTER_UNAVAILABLE");
    }
    const byKey = new Map(views.map((gate) => [gate.gateKey, gate]));
    const inactive = gateKeys.filter(
      (gateKey) => byKey.get(gateKey)?.activationAllowed !== true,
    );
    if (inactive.length > 0)
      throw new Error(`WORKFLOW_EXTERNAL_GATE_INACTIVE:${inactive.join(",")}`);
  }
}

export interface ProductionWorkflowProviderSelections {
  billing: SelectedProvider<{
    billing: BillingPort;
    metering: StripeLedgerBillingPort;
    adjustments: Pick<
      StripeCommercialGateway,
      "issueCreditNote" | "refundPayment"
    >;
  }>;
  accounting: SelectedProvider<{ sink: AccountingExportSink }>;
  notifications: SelectedProvider<{ client: NotificationProviderClient }>;
  usage: SelectedProvider<{ client: UsageProviderClient }>;
  workos: SelectedProvider<{ client: WorkosClient }>;
  evidence: SelectedProvider<{
    core: CoreEvidenceStoragePort;
    lifecycle: LifecycleEvidenceStoragePort;
  }>;
  provisioning: SelectedProvider<{ provider: ProvisioningPort }>;
}

export interface ProductionWorkflowProviderFactoryOptions {
  providers: ProductionWorkflowProviderSelections;
  authorizationSecret: string;
  coreTaskSubmitter: CoreWorkflowTaskSubmitter;
  exceptionRouting: WorkflowExceptionRouting;
  outboxHandlers?: ReadonlyMap<string, OutboxTopicHandler>;
  deletionCertificates?: {
    issuer: DeletionCertificateParty;
    brand?: DeletionCertificateBrand;
    locale?: DeletionCertificateLocale;
    automatedTeardownEnabled: boolean;
    renderer: DeletionCertificateRenderer;
  };
  commercialArtifacts?: {
    platformIssuer: CommercialArtifactParty;
    renderer: CommercialArtifactRenderer;
  };
  activationGuard?: WorkflowProviderActivationGuard;
  clock?: () => Date;
  leaseMs?: number;
}

const providerActivationGates = [
  "EXT-ACC-01",
  "EXT-COMMERCIAL-01",
  "EXT-PROVIDER-01",
  "EXT-PROVISION-01",
  "EXT-TAX-01",
  "EXT-APPROVERS-01",
  "EXT-LEGAL-01",
] as const satisfies readonly ExternalGateKey[];

async function validateSelection(
  name: keyof ProductionWorkflowProviderSelections,
  selection: SelectedProvider<unknown>,
  runtimeEnvironment: "development" | "test" | "production",
  now: Date,
): Promise<void> {
  if (runtimeEnvironment === "production" && selection.mode !== "live")
    throw new Error(`WORKFLOW_PRODUCTION_SIMULATOR_FORBIDDEN:${name}`);
  let result: ExternalGateActivationTestResult;
  try {
    result = await selection.activationTest();
  } catch {
    throw new Error(`WORKFLOW_PROVIDER_ACTIVATION_TEST_FAILED:${name}`);
  }
  if (
    result.status !== "passed" ||
    result.simulatorState !== "ready" ||
    !externalGateActivationTestIsCurrent(result.testedAt, now)
  )
    throw new Error(`WORKFLOW_PROVIDER_ACTIVATION_TEST_FAILED:${name}`);
  try {
    sanitizeActivationEvidenceReference(result.evidenceReference);
  } catch {
    throw new Error(`WORKFLOW_PROVIDER_ACTIVATION_EVIDENCE_INVALID:${name}`);
  }
}

/**
 * Creates the complete production adapter bundle from explicit provider
 * selections. The same composition accepts deterministic simulators outside
 * production, while production is closed by persisted gates and live probes.
 */
export function createProductionWorkflowAdapterFactory(
  options: ProductionWorkflowProviderFactoryOptions,
): ProductionWorkflowAdapterFactory {
  return {
    async create({
      db,
      environment,
    }): Promise<ProductionWorkflowAdapterBundle> {
      if (!options.exceptionRouting)
        throw new Error("WORKFLOW_PROVIDER_NOT_CONFIGURED:exception_routing");
      const guard =
        options.activationGuard ??
        new PersistedWorkflowProviderActivationGuard(db, options.clock);
      await guard.requireActive(
        providerActivationGates,
        `workflow-bootstrap:${crypto.randomUUID()}`,
      );
      const now = (options.clock ?? (() => new Date()))();
      const selections: readonly [
        keyof ProductionWorkflowProviderSelections,
        SelectedProvider<unknown>,
      ][] = [
        ["billing", options.providers.billing],
        ["accounting", options.providers.accounting],
        ["notifications", options.providers.notifications],
        ["usage", options.providers.usage],
        ["workos", options.providers.workos],
        ["evidence", options.providers.evidence],
        ["provisioning", options.providers.provisioning],
      ];
      await Promise.all(
        selections.map(([name, selection]) =>
          validateSelection(
            name,
            selection,
            environment.runtimeEnvironment,
            now,
          ),
        ),
      );

      const { providers } = options;
      const outboxHandlers = new Map(options.outboxHandlers);
      const configuredTopics = new Set(outboxHandlers.keys());
      const requiredHandlers = [
        createLifecycleTaskOutboxHandlers(),
        createCoreWorkflowOutboxHandlers({
          db,
          authorizationSecret: options.authorizationSecret,
          submit: options.coreTaskSubmitter,
        }),
        createStripeAdjustmentOutboxHandlers({
          db,
          stripe: providers.billing.value.adjustments,
        }),
      ];
      const scheduledTopic = "core.schedule.dispatch.v1";
      if (outboxHandlers.has(scheduledTopic))
        throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${scheduledTopic}`);
      outboxHandlers.set(
        scheduledTopic,
        createCoreScheduledOutboxHandler({
          db,
          authorizationSecret: options.authorizationSecret,
          submit: options.coreTaskSubmitter,
        }),
      );
      for (const handlers of requiredHandlers) {
        for (const [topic, handler] of handlers) {
          if (configuredTopics.has(topic))
            throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${topic}`);
          const existing = outboxHandlers.get(topic);
          if (existing && topic !== "order.provisioning_confirmed")
            throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${topic}`);
          if (existing) {
            outboxHandlers.set(topic, async (delivery) => {
              await existing(delivery);
              await handler(delivery);
            });
            continue;
          }
          outboxHandlers.set(topic, handler);
        }
      }
      const accounting = new QboNeutralAccountingAdapter(
        providers.accounting.value.sink,
        {
          ...(options.clock ? { now: options.clock } : {}),
          vendorMappings: new DatabaseQboVendorMappingResolver(db),
        },
      );
      return {
        coreProviders: {
          billing: providers.billing.value.billing,
          metering: providers.billing.value.metering,
          accounting,
          commissionAccounting: accounting,
          notifications: new CoreNotificationAdapter(
            providers.notifications.value.client,
          ),
          usage: new OrchestratorUsageAdapter(providers.usage.value.client),
          exports: providers.evidence.value.core,
        },
        exceptionRouting: options.exceptionRouting,
        lifecycleHandlers: createAuthoritativeLifecycleHandlers({
          store: new DatabaseAuthoritativeLifecycleTaskStore(db),
          provisioning: {
            store: new DatabaseProvisioningDispatchStore(db, options.clock),
            provider: providers.provisioning.value.provider,
          },
        }),
        outboxHandlers,
        workosIdentity: new WorkosIdentityAdapter(
          providers.workos.value.client,
        ),
        ...(options.deletionCertificates
          ? {
              deletionCertificates: {
                evidence: providers.evidence.value.lifecycle,
                ...options.deletionCertificates,
              },
            }
          : {}),
        ...(options.commercialArtifacts
          ? {
              commercialArtifacts: {
                evidence: providers.evidence.value.lifecycle,
                ...options.commercialArtifacts,
              },
            }
          : {}),
        ...(options.clock ? { clock: options.clock } : {}),
        ...(options.leaseMs ? { leaseMs: options.leaseMs } : {}),
      };
    },
  };
}
