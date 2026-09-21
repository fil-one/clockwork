import type {
  BillingPort,
  EvidenceStoragePort as CoreEvidenceStoragePort,
  ProvisioningPort,
  TaxPort,
} from "@clockwork/contracts";
import {
  DatabaseAuthoritativeLifecycleTaskStore,
  DatabasePersistedWorkflowExceptionRouting,
  DatabaseExternalGateService,
  DatabaseSystemCapabilityGuard,
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
  PersistedProviderGateStateStore,
  ProviderRuntime,
  ProviderRuntimeDeniedError,
  QboNeutralAccountingAdapter,
  TypedLifecycleProviderEffectExecutor,
  WorkosIdentityAdapter,
  type AccountingExportSink,
  type EvidenceStoragePort as LifecycleEvidenceStoragePort,
  type LifecycleEffectProviderPorts,
  type LifecycleProviderEffectLike,
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
import { createProductionExperienceOutboxHandlers } from "../experience";
import {
  createLifecycleTaskOutboxHandlers,
  QueuedLifecycleTaskSubmitter,
  type LifecycleTaskSubmissionPort,
} from "../system/lifecycle-task-dispatch";
import {
  createWebhookReplayOutboxHandler,
  QueuedWebhookReplayTaskSubmitter,
  type WebhookReplayTaskSubmitter,
} from "../webhook-replay/outbox";
import { ProductionWebhookReplayHandler } from "../webhook-replay/runtime";
import type {
  ProductionWorkflowAdapterBundle,
  ProductionWorkflowAdapterFactory,
} from "./workflow-runtime";
import { createAuthoritativeLifecycleHandlers } from "./provider-lifecycle";
import {
  activationTaskKey,
  createDatabaseExternalGateActivationRunner,
} from "./gate-activation";

export type ProviderAdapterMode = "live" | "simulator";

export interface SelectedProvider<T> {
  mode: ProviderAdapterMode;
  /** Omitted at boot because all owning capabilities are disabled. */
  disabled?: boolean;
  value: T;
  activationTest(): Promise<ExternalGateActivationTestResult>;
}

export interface WorkflowProviderActivationGuard {
  requireActive(
    gateKeys: readonly ExternalGateKey[],
    requestId: string,
  ): Promise<void>;
}

export interface PersistedExternalGateReader {
  list(input: {
    requestId: string;
    now: Date;
  }): ReturnType<DatabaseExternalGateService["list"]>;
}

export class PersistedWorkflowProviderActivationGuard implements WorkflowProviderActivationGuard {
  private readonly gates: PersistedExternalGateReader;

  public constructor(
    database: RuntimeDatabase,
    private readonly now: () => Date = () => new Date(),
    gates?: PersistedExternalGateReader,
  ) {
    this.gates = gates ?? new DatabaseExternalGateService(database);
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

  /** Allows a stale active gate to run its bounded activation probe, never business effects. */
  public async requireConfiguredForActivation(
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
    const unavailable = gateKeys.filter((gateKey) => {
      const gate = byKey.get(gateKey);
      return (
        !gate ||
        gate.configuredStatus !== "active" ||
        gate.blockedReasons.includes("emergency_disabled")
      );
    });
    if (unavailable.length > 0)
      throw new Error(
        `WORKFLOW_EXTERNAL_GATE_ACTIVATION_NOT_CONFIGURED:${unavailable.join(",")}`,
      );
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
  screening: SelectedProvider<{
    provider: LifecycleEffectProviderPorts["screening"];
  }>;
  signature: SelectedProvider<{
    provider: LifecycleEffectProviderPorts["signature"];
  }>;
  /**
   * The tax engine every invoice writer determines against. It is a first-class
   * selection rather than an optional extra because an absent tax source is a
   * zero-tax invoice, and `EXT-TAX-01` is explicit that acceptance is refused
   * until an approved engine exists.
   */
  tax: SelectedProvider<{ provider: TaxPort }>;
}

export interface ProductionWorkflowProviderFactoryOptions {
  providers: ProductionWorkflowProviderSelections;
  activationGateKeys?: readonly ExternalGateKey[];
  authorizationSecret: string;
  coreTaskSubmitter: CoreWorkflowTaskSubmitter;
  /**
   * Where the ten event-driven lifecycle tasks are submitted. Defaults to the
   * durable queue; a test supplies a recorder. Nothing here may execute the
   * effect inline -- the only caller is the outbox dispatcher's cron.
   */
  lifecycleTaskSubmitter?: LifecycleTaskSubmissionPort;
  webhookReplayTaskSubmitter?: WebhookReplayTaskSubmitter;
  exceptionRouting?: WorkflowExceptionRouting;
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

const providerGate = {
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
} as const satisfies Readonly<
  Record<keyof ProductionWorkflowProviderSelections, ExternalGateKey>
>;

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
  } catch (error) {
    // The probe's own failure is the only description of why the provider is
    // not live; discarding it leaves an operator a provider name and nothing
    // to act on.
    throw new Error(`WORKFLOW_PROVIDER_ACTIVATION_TEST_FAILED:${name}`, {
      cause: error,
    });
  }
  if (
    result.status !== "passed" ||
    result.simulatorState !== "ready" ||
    !externalGateActivationTestIsCurrent(result.testedAt, now)
  )
    throw new Error(`WORKFLOW_PROVIDER_ACTIVATION_TEST_FAILED:${name}`);
  try {
    sanitizeActivationEvidenceReference(result.evidenceReference);
  } catch (error) {
    throw new Error(`WORKFLOW_PROVIDER_ACTIVATION_EVIDENCE_INVALID:${name}`, {
      cause: error,
    });
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
      const exceptionRouting =
        options.exceptionRouting ??
        new DatabasePersistedWorkflowExceptionRouting(db, options.clock);
      const persistedGuard = options.activationGuard
        ? undefined
        : new PersistedWorkflowProviderActivationGuard(db, options.clock);
      const guard = options.activationGuard ?? persistedGuard;
      if (!guard) throw new Error("WORKFLOW_EXTERNAL_GATE_GUARD_UNAVAILABLE");
      const activeGateKeys =
        options.activationGateKeys ?? providerActivationGates;
      if (persistedGuard)
        await persistedGuard.requireConfiguredForActivation(
          activeGateKeys,
          `workflow-bootstrap:preflight:${crypto.randomUUID()}`,
        );
      else
        await guard.requireActive(
          activeGateKeys,
          `workflow-bootstrap:${crypto.randomUUID()}`,
        );
      const now = (options.clock ?? (() => new Date()))();
      const allSelections: readonly [
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
        ["screening", options.providers.screening],
        ["signature", options.providers.signature],
        ["tax", options.providers.tax],
      ];
      const selections = allSelections.filter(
        ([, selection]) => !selection.disabled,
      );
      let gateActivationExecutor:
        ProductionWorkflowAdapterBundle["gateActivationExecutor"] | undefined;
      if (options.activationGuard) {
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
      } else {
        const runner = createDatabaseExternalGateActivationRunner(
          db,
          options.clock,
        );
        const byProvider = new Map(selections);
        const execute = (
          name: keyof ProductionWorkflowProviderSelections,
          taskKey: string,
          requestId: string,
          actor: { kind: "user" | "system"; id: string } = {
            kind: "system",
            id: "external-gate-activation-runner",
          },
        ) => {
          const selection = byProvider.get(name);
          if (!selection)
            throw new Error(`WORKFLOW_PROVIDER_NOT_CONFIGURED:${name}`);
          return runner.run({
            taskKey,
            gateKey: providerGate[name],
            provider: name,
            mode: selection.mode,
            runtimeEnvironment: environment.runtimeEnvironment,
            actor,
            requestId,
            probe: () => selection.activationTest(),
          });
        };
        for (const [name] of selections)
          await execute(
            name,
            activationTaskKey({
              gateKey: providerGate[name],
              provider: name,
              now,
            }),
            `workflow-bootstrap:activation:${name}`,
          );
        await guard.requireActive(
          activeGateKeys,
          `workflow-bootstrap:post-activation:${crypto.randomUUID()}`,
        );
        gateActivationExecutor = async (payload, requestId) => {
          if (!(payload.provider in providerGate))
            throw new Error(
              `WORKFLOW_PROVIDER_NOT_CONFIGURED:${payload.provider}`,
            );
          const name =
            payload.provider as keyof ProductionWorkflowProviderSelections;
          if (providerGate[name] !== payload.gateKey)
            throw new Error("EXTERNAL_GATE_ACTIVATION_SCOPE_MISMATCH");
          const currentGate = await new DatabaseExternalGateService(db).get({
            gateKey: payload.gateKey,
            requestId: `${requestId}:version-check`,
            now: (options.clock ?? (() => new Date()))(),
          });
          if (currentGate.rowVersion !== payload.expectedGateRowVersion)
            throw new Error("EXTERNAL_GATE_VERSION_CONFLICT");
          return execute(name, payload.taskKey, requestId, {
            kind: "user",
            id: payload.requestedBy,
          });
        };
      }

      const { providers } = options;
      const lifecycleNotification = new CoreNotificationAdapter(
        providers.notifications.value.client,
      );
      const gateService = new DatabaseExternalGateService(db);
      const lifecycleEffects = new TypedLifecycleProviderEffectExecutor(
        new ProviderRuntime(
          new PersistedProviderGateStateStore(gateService, options.clock),
          options.clock,
        ),
        {
          screening: providers.screening.value.provider,
          notifications: lifecycleNotification,
          signature: providers.signature.value.provider,
          evidence: providers.evidence.value.core,
          provisioning: providers.provisioning.value.provider,
        },
        (effect) => ({
          environment: environment.runtimeEnvironment,
          mode: lifecycleProviderMode(providers, effect),
          boundary: "lifecycle",
          requestId: `lifecycle-provider:${effect.effectKey}`,
          effectId: effect.effectKey,
        }),
        async (effect) => {
          const capability = lifecycleCapability(effect);
          if (!capability) return;
          try {
            if (environment.runtimeEnvironment === "production") {
              const systemCapability =
                capability === "legal_execution"
                  ? "legal"
                  : capability === "provisioning_invoicing"
                    ? "billing"
                    : capability === "migration"
                      ? "new_business"
                      : capability;
              const internal = await new DatabaseSystemCapabilityGuard(
                db,
              ).require({
                capabilities: [systemCapability],
                recovery: false,
                requestId: `lifecycle-system-capability:${effect.effectKey}`,
              });
              if (!internal.allowed)
                throw new Error("SYSTEM_CAPABILITY_DISABLED");
            }
            await gateService.requireCapability({
              capability,
              boundary: "lifecycle",
              effectIntent: "external_effect",
              requestId: `lifecycle-capability:${effect.effectKey}`,
              now: (options.clock ?? (() => new Date()))(),
            });
          } catch (error) {
            throw new ProviderRuntimeDeniedError(
              error instanceof Error &&
                error.message === "EXTERNAL_GATE_REGISTER_UNAVAILABLE"
                ? "PROVIDER_GATE_REGISTER_UNAVAILABLE"
                : "PROVIDER_GATE_INACTIVE",
            );
          }
        },
      );
      const outboxHandlers = new Map(options.outboxHandlers);
      const configuredTopics = new Set(outboxHandlers.keys());
      const requiredHandlers = [
        createLifecycleTaskOutboxHandlers(
          options.lifecycleTaskSubmitter ?? new QueuedLifecycleTaskSubmitter(),
        ),
        createCoreWorkflowOutboxHandlers({
          db,
          authorizationSecret: options.authorizationSecret,
          tax: providers.tax.value.provider,
          submit: options.coreTaskSubmitter,
        }),
        createStripeAdjustmentOutboxHandlers({
          db,
          stripe: providers.billing.value.adjustments,
        }),
        createProductionExperienceOutboxHandlers({
          database: db,
          authorizationSecret: options.authorizationSecret,
          tax: providers.tax.value.provider,
          ...(options.leaseMs ? { leaseMs: options.leaseMs } : {}),
          ...(options.clock ? { clock: options.clock } : {}),
        }),
      ];
      if (outboxHandlers.has("system.webhook_replay.requested"))
        throw new Error(
          "WORKFLOW_PROVIDER_DUPLICATE:system.webhook_replay.requested",
        );
      outboxHandlers.set(
        "system.webhook_replay.requested",
        createWebhookReplayOutboxHandler(
          options.webhookReplayTaskSubmitter ??
            new QueuedWebhookReplayTaskSubmitter(),
        ),
      );
      const scheduledTopic = "core.schedule.dispatch.v1";
      if (outboxHandlers.has(scheduledTopic))
        throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${scheduledTopic}`);
      outboxHandlers.set(
        scheduledTopic,
        createCoreScheduledOutboxHandler({
          db,
          authorizationSecret: options.authorizationSecret,
          tax: providers.tax.value.provider,
          submit: options.coreTaskSubmitter,
        }),
      );
      for (const handlers of requiredHandlers) {
        for (const [topic, handler] of handlers) {
          if (configuredTopics.has(topic))
            throw new Error(`WORKFLOW_PROVIDER_DUPLICATE:${topic}`);
          const existing = outboxHandlers.get(topic);
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
        exceptionRouting,
        lifecycleHandlers: createAuthoritativeLifecycleHandlers({
          store: new DatabaseAuthoritativeLifecycleTaskStore(db),
          effects: lifecycleEffects,
          provisioning: {
            store: new DatabaseProvisioningDispatchStore(db, options.clock),
            provider: providers.provisioning.value.provider,
          },
        }),
        outboxHandlers,
        workosIdentity: new WorkosIdentityAdapter(
          providers.workos.value.client,
        ),
        webhookReplayHandler: new ProductionWebhookReplayHandler({
          database: db,
          authorizationSecret: options.authorizationSecret,
          tax: providers.tax.value.provider,
          exceptionRouting: new DatabasePersistedWorkflowExceptionRouting(
            db,
            options.clock,
          ),
        }),
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
        ...(gateActivationExecutor ? { gateActivationExecutor } : {}),
      };
    },
  };
}

function lifecycleProviderMode(
  providers: ProductionWorkflowProviderSelections,
  effect: LifecycleProviderEffectLike,
): ProviderAdapterMode {
  switch (effect.effectBoundary) {
    case "screening_provider":
      return providers.screening.mode;
    case "notification_provider":
      return providers.notifications.mode;
    case "signature_provider":
      return providers.signature.mode;
    case "evidence_provider":
      return providers.evidence.mode;
    case "provisioning_provider":
      return providers.provisioning.mode;
    case "human_wait":
    case "persisted_transition":
      return "simulator";
  }
}

function lifecycleCapability(
  effect: LifecycleProviderEffectLike,
):
  | "new_business"
  | "legal_execution"
  | "provisioning_invoicing"
  | "teardown"
  | "migration"
  | undefined {
  if (effect.taskId.startsWith("lifecycle-onboarding-")) return "new_business";
  if (effect.taskId.startsWith("lifecycle-agreements-"))
    return "legal_execution";
  if (
    effect.taskId.startsWith("lifecycle-provisioning-") ||
    effect.taskId.startsWith("lifecycle-pocs-") ||
    effect.taskId.startsWith("lifecycle-renewals-")
  )
    return "provisioning_invoicing";
  if (effect.taskId.startsWith("lifecycle-offboarding-")) return "teardown";
  if (effect.taskId.startsWith("lifecycle-migrations-")) return "migration";
  return undefined;
}
