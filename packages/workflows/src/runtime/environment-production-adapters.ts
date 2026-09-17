import { z } from "zod";

import {
  DatabaseCrmAccountRecordStore,
  DatabaseExternalGateService,
  DatabaseNotificationTenantDirectory,
  type RuntimeDatabase,
} from "@clockwork/db";
import {
  type ClockworkTelemetry,
  createCrmProjectionOutboxHandlers,
  FetchJsonProviderTransport,
  GuardedProviderJsonTransport,
  HttpAccountingExportSink,
  HttpCoreEvidenceStorageAdapter,
  HttpCrmProviderClient,
  HttpLifecycleEvidenceStorageAdapter,
  HttpLifecycleScreeningAdapter,
  HttpLifecycleSignatureAdapter,
  HttpNotificationProviderClient,
  HttpProviderActivationTestClient,
  HttpProvisioningAdapter,
  HttpTaxAdapter,
  HttpUsageProviderClient,
  HttpWorkosMfaPolicyEnforcer,
  OutboundCrmProjectionAdapter,
  PersistedProviderGateStateStore,
  ProviderRuntime,
  StripeFinanceGateway,
  TenantBrandedNotificationClient,
  TelemetryProviderJsonTransport,
  WorkosSdkOrganizationClient,
  type NotificationProviderClient,
  type NotificationTenantDirectory,
  type ProviderJsonTransport,
  type RuntimeBoundaryInstrumentation,
} from "@clockwork/integrations";

import { resolveTaskSubmitter, type TaskSubmitter } from "../tasks/submitter";
import type {
  ProductionWorkflowAdapterFactory,
  WorkflowRuntimeEnvironmentSource,
} from "./workflow-runtime";
import type {
  CommercialArtifactParty,
  CommercialArtifactRenderer,
} from "../core/commercial-artifact-handler";
import type { CoreWorkflowTaskSubmitter } from "../core/outbox-handlers";
import type { DeletionCertificateRenderer } from "../offboarding/deletion-certificate-handler";
import { createProductionWorkflowAdapterFactory } from "./production-adapter-factory";
import {
  disabledWorkflowProvider,
  type WorkflowCapabilityProfile,
  type WorkflowProviderName,
} from "./capability-profile";

const PartySchema = z.object({
  legalName: z.string().min(1),
  address: z.object({
    line1: z.string().min(1),
    line2: z.string().optional(),
    locality: z.string().min(1),
    region: z.string().optional(),
    postalCode: z.string().min(1),
    countryCode: z.string().min(2),
  }),
  taxId: z.string().optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
});

function party(input: z.output<typeof PartySchema>): CommercialArtifactParty {
  return {
    legalName: input.legalName,
    address: {
      line1: input.address.line1,
      ...(input.address.line2 ? { line2: input.address.line2 } : {}),
      locality: input.address.locality,
      ...(input.address.region ? { region: input.address.region } : {}),
      postalCode: input.address.postalCode,
      countryCode: input.address.countryCode,
    },
    ...(input.taxId ? { taxId: input.taxId } : {}),
    ...(input.contactName ? { contactName: input.contactName } : {}),
    ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
  };
}

const RenderedArtifactResponseSchema = z.object({
  bytesBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.literal("application/pdf"),
  recordHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  documentId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
});

function artifactBytes(value: string): Uint8Array {
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0)
    throw new Error("DOCUMENT_RENDERER_RETURNED_EMPTY_ARTIFACT");
  return bytes;
}

function documentRenderers(rendererTransport: ProviderJsonTransport): {
  commercial: CommercialArtifactRenderer;
  deletion: DeletionCertificateRenderer;
} {
  return {
    commercial: {
      async render(input) {
        const response = await rendererTransport.request({
          operation: "render-commercial-artifact",
          path: "/v1/commercial-artifacts/render",
          body: {
            request: input.request,
            platformIssuer: input.platformIssuer,
          },
          response: RenderedArtifactResponseSchema,
          idempotencyKey: input.request.requestHash,
        });
        if (
          response.recordHash === undefined ||
          response.documentId === undefined ||
          response.version === undefined
        )
          throw new Error("DOCUMENT_RENDERER_RESPONSE_BINDING_MISSING");
        return {
          bytes: artifactBytes(response.bytesBase64),
          contentHash: response.contentHash,
          recordHash: response.recordHash,
          documentId: response.documentId,
          version: response.version,
          mimeType: response.mimeType,
        };
      },
    },
    deletion: {
      async render(request, presentation) {
        const response = await rendererTransport.request({
          operation: "render-deletion-certificate",
          path: "/v1/deletion-certificates/render",
          body: { request, presentation },
          response: RenderedArtifactResponseSchema,
          idempotencyKey: request.requestHash,
        });
        return {
          bytes: artifactBytes(response.bytesBase64),
          contentHash: response.contentHash,
          mimeType: response.mimeType,
        };
      },
    },
  };
}

export class WorkflowEnvironmentAdapterConfigurationError extends Error {
  public constructor(
    public readonly missing: readonly string[],
    public readonly externalGates: readonly string[],
  ) {
    super(`WORKFLOW_ADAPTER_ENVIRONMENT_INCOMPLETE:${missing.join(",")}`);
    this.name = "WorkflowEnvironmentAdapterConfigurationError";
  }
}

function required(
  source: WorkflowRuntimeEnvironmentSource,
  name: string,
  gate: string,
): string {
  const value = source[name]?.trim();
  if (!value)
    throw new WorkflowEnvironmentAdapterConfigurationError([name], [gate]);
  return value;
}

function json<T>(
  source: WorkflowRuntimeEnvironmentSource,
  name: string,
  gate: string,
  schema: z.ZodType<T>,
): T {
  const value = required(source, name, gate);
  try {
    return schema.parse(JSON.parse(value));
  } catch {
    throw new WorkflowEnvironmentAdapterConfigurationError([name], [gate]);
  }
}

class QueuedCoreWorkflowTaskSubmitter implements CoreWorkflowTaskSubmitter {
  private readonly submitter: TaskSubmitter;

  public constructor(submitter: TaskSubmitter = resolveTaskSubmitter()) {
    this.submitter = submitter;
  }

  public submit(input: Parameters<CoreWorkflowTaskSubmitter["submit"]>[0]) {
    return this.submitter.submit({
      taskId: input.taskId,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
    });
  }
}

function transport(
  source: WorkflowRuntimeEnvironmentSource,
  prefix: string,
  provider: string,
  gate: string,
  allowInsecureLocalhost: boolean,
  instrumentation?: RuntimeBoundaryInstrumentation,
  telemetry?: ClockworkTelemetry,
): ProviderJsonTransport {
  const inner = new FetchJsonProviderTransport({
    baseUrl: required(source, `${prefix}_BASE_URL`, gate),
    bearerToken: required(source, `${prefix}_TOKEN`, gate),
    provider,
    allowInsecureLocalhost,
  });
  return instrumentation && telemetry
    ? new TelemetryProviderJsonTransport(
        inner,
        telemetry,
        () => instrumentation.currentCorrelation() ?? {},
        () => instrumentation.currentContext(),
        provider,
      )
    : inner;
}

/** Builds the default worker composition exclusively from registered env inputs. */
export function createEnvironmentWorkflowAdapterFactory(
  source: WorkflowRuntimeEnvironmentSource,
  instrumentation?: RuntimeBoundaryInstrumentation,
  telemetry?: ClockworkTelemetry,
  capabilityProfile?: WorkflowCapabilityProfile,
) {
  const needed = (name: WorkflowProviderName) =>
    !capabilityProfile || capabilityProfile.providers.includes(name);
  const artifactsNeeded = capabilityProfile?.artifacts ?? true;
  const crmEnabled =
    !capabilityProfile || source.CLOCKWORK_CRM_ENABLED === "true";
  const selectedTransport: typeof transport = (...args) => {
    const prefix = args[1];
    const owner: Record<string, WorkflowProviderName> = {
      ACCOUNTING_PROVIDER: "accounting",
      NOTIFICATION_PROVIDER: "notifications",
      USAGE_PROVIDER: "usage",
      PROVISIONING_PROVIDER: "provisioning",
      SCREENING_PROVIDER: "screening",
      SIGNATURE_PROVIDER: "signature",
      EVIDENCE_PROVIDER: "evidence",
      TAX_PROVIDER: "tax",
      WORKOS_MFA_PROVIDER: "workos",
    };
    const enabled =
      prefix === "WORKFLOW_PROVIDER_CONTROL"
        ? !capabilityProfile || capabilityProfile.providers.length > 0
        : prefix === "DOCUMENT_RENDERER_PROVIDER"
          ? artifactsNeeded
          : prefix === "CRM_PROVIDER"
            ? crmEnabled
            : owner[prefix]
              ? needed(owner[prefix])
              : false;
    return enabled
      ? transport(...args)
      : disabledWorkflowProvider<ProviderJsonTransport>(args[2]);
  };
  const runtimeEnvironment = required(source, "NODE_ENV", "EXT-ACC-01");
  if (
    runtimeEnvironment === "production" &&
    source.CLOCKWORK_ENABLE_SIMULATORS === "true"
  )
    throw new WorkflowEnvironmentAdapterConfigurationError(
      ["CLOCKWORK_ENABLE_SIMULATORS:production_forbidden"],
      ["EXT-ACC-01"],
    );
  const allowInsecureLocalhost = runtimeEnvironment !== "production";
  const control = new HttpProviderActivationTestClient(
    selectedTransport(
      source,
      "WORKFLOW_PROVIDER_CONTROL",
      "workflow-provider-control",
      "EXT-ACC-01",
      allowInsecureLocalhost,
      instrumentation,
      telemetry,
    ),
  );
  const activationTest = (provider: string) => () => control.run(provider);
  const accountingTransport = selectedTransport(
    source,
    "ACCOUNTING_PROVIDER",
    "accounting",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const notificationTransport = selectedTransport(
    source,
    "NOTIFICATION_PROVIDER",
    "notifications",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const usageTransport = selectedTransport(
    source,
    "USAGE_PROVIDER",
    "usage",
    "EXT-PROVISION-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const provisioningTransport = selectedTransport(
    source,
    "PROVISIONING_PROVIDER",
    "provisioning",
    "EXT-PROVISION-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const screeningTransport = selectedTransport(
    source,
    "SCREENING_PROVIDER",
    "screening",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  // CRM is an explicit production opt-in. When enabled its credentials are
  // required; when omitted no CRM consumer is attached to the worker.
  const crmTransport = selectedTransport(
    source,
    "CRM_PROVIDER",
    "crm",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const signatureTransport = selectedTransport(
    source,
    "SIGNATURE_PROVIDER",
    "signature",
    "EXT-LEGAL-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const evidenceTransport = selectedTransport(
    source,
    "EVIDENCE_PROVIDER",
    "evidence",
    "EXT-ACC-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  // Billing-capable workers require a configured tax provider. Omitted billing
  // uses a denial port, so it cannot silently invoice customers without tax.
  const taxTransport = selectedTransport(
    source,
    "TAX_PROVIDER",
    "tax",
    "EXT-TAX-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const documentRendererTransport = selectedTransport(
    source,
    "DOCUMENT_RENDERER_PROVIDER",
    "document-renderer",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const workosMfaTransport = selectedTransport(
    source,
    "WORKOS_MFA_PROVIDER",
    "workos-mfa",
    "EXT-ACC-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const stripe = needed("billing")
    ? new StripeFinanceGateway({
        apiKey: required(source, "STRIPE_SECRET_KEY", "EXT-ACC-01"),
      })
    : disabledWorkflowProvider<StripeFinanceGateway>("billing");
  const issuer = artifactsNeeded
    ? party(json(source, "PLATFORM_ISSUER_JSON", "EXT-LEGAL-01", PartySchema))
    : undefined;
  const notifications = createRuntimeBoundNotificationClient(
    notificationTransport,
  );
  const renderers = documentRenderers(documentRendererTransport);
  const evidence = {
    core: new HttpCoreEvidenceStorageAdapter(evidenceTransport),
    lifecycle: new HttpLifecycleEvidenceStorageAdapter(evidenceTransport),
  };
  const factory = createProductionWorkflowAdapterFactory({
    authorizationSecret: required(
      source,
      "AUTHORIZATION_CONTEXT_SECRET",
      "EXT-ACC-01",
    ),
    coreTaskSubmitter: new QueuedCoreWorkflowTaskSubmitter(),
    ...(capabilityProfile
      ? { activationGateKeys: capabilityProfile.gateKeys }
      : {}),
    providers: {
      billing: {
        mode: "live",
        disabled: !needed("billing"),
        value: { billing: stripe, metering: stripe, adjustments: stripe },
        activationTest: activationTest("billing"),
      },
      accounting: {
        mode: "live",
        disabled: !needed("accounting"),
        value: { sink: new HttpAccountingExportSink(accountingTransport) },
        activationTest: activationTest("accounting"),
      },
      notifications: {
        mode: "live",
        disabled: !needed("notifications"),
        value: { client: notifications.client },
        activationTest: activationTest("notifications"),
      },
      usage: {
        mode: "live",
        disabled: !needed("usage"),
        value: { client: new HttpUsageProviderClient(usageTransport) },
        activationTest: activationTest("usage"),
      },
      workos: {
        mode: "live",
        disabled: !needed("workos"),
        value: {
          client: needed("workos")
            ? new WorkosSdkOrganizationClient({
                apiKey: required(source, "WORKOS_API_KEY", "EXT-ACC-01"),
                mfaPolicyEnforcer: new HttpWorkosMfaPolicyEnforcer(
                  workosMfaTransport,
                ),
              })
            : disabledWorkflowProvider<WorkosSdkOrganizationClient>("workos"),
        },
        activationTest: activationTest("workos"),
      },
      evidence: {
        mode: "live",
        disabled: !needed("evidence"),
        value: evidence,
        activationTest: activationTest("evidence"),
      },
      provisioning: {
        mode: "live",
        disabled: !needed("provisioning"),
        value: { provider: new HttpProvisioningAdapter(provisioningTransport) },
        activationTest: activationTest("provisioning"),
      },
      screening: {
        mode: "live",
        disabled: !needed("screening"),
        value: {
          provider: new HttpLifecycleScreeningAdapter(screeningTransport),
        },
        activationTest: activationTest("screening"),
      },
      signature: {
        mode: "live",
        disabled: !needed("signature"),
        value: {
          provider: needed("signature")
            ? new HttpLifecycleSignatureAdapter(
                signatureTransport,
                json(
                  source,
                  "SIGNATURE_PROVIDER_SIGNING_ORIGINS_JSON",
                  "EXT-LEGAL-01",
                  z.array(z.url()).min(1).max(20),
                ),
              )
            : disabledWorkflowProvider<HttpLifecycleSignatureAdapter>(
                "signature",
              ),
        },
        activationTest: activationTest("signature"),
      },
      tax: {
        mode: "live",
        disabled: !needed("tax"),
        value: { provider: new HttpTaxAdapter(taxTransport) },
        activationTest: activationTest("tax"),
      },
    },
    ...(issuer
      ? {
          deletionCertificates: {
            issuer,
            automatedTeardownEnabled:
              source.AUTOMATED_TEARDOWN_ENABLED === "true",
            renderer: renderers.deletion,
          },
          commercialArtifacts: {
            platformIssuer: issuer,
            renderer: renderers.commercial,
          },
        }
      : {}),
  });
  return withRuntimeBoundAdapters(
    factory,
    crmEnabled ? crmTransport : undefined,
    notifications.bind,
  );
}

/**
 * The delivery client the production composition hands to
 * `CoreNotificationAdapter`, which hard-codes the first-party sender: a partner
 * reselling under its own brand had its end client emailed by Fil One.
 *
 * The tenant directory reads persisted state, so it cannot exist until the
 * worker has its runtime handle. Until `bind` supplies one the client refuses to
 * send rather than falling back to the first-party sender -- an unresolvable
 * tenant is exactly the case that must not be assumed first-party.
 */
export function createRuntimeBoundNotificationClient(
  transport: ProviderJsonTransport,
): {
  client: NotificationProviderClient;
  bind: (db: RuntimeDatabase) => void;
} {
  let directory: NotificationTenantDirectory | undefined;
  return {
    client: new TenantBrandedNotificationClient(
      new HttpNotificationProviderClient(transport),
      () => directory,
    ),
    bind: (db) => {
      directory = new DatabaseNotificationTenantDirectory(db);
    },
  };
}

/**
 * Completes the composition with the two adapters that need the runtime
 * database handle, which only exists once the factory is asked to create: the
 * notification tenant directory that decides which brand a message is sent
 * under, and the outbound CRM consumer (§15).
 *
 * The CRM consumer is added here rather than through `outboxHandlers` because
 * both the account binding and the persisted gate check need that same handle.
 *
 * The transport is wrapped in `GuardedProviderJsonTransport`, so the upsert is
 * denied from persisted `EXT-ACC-01`/`EXT-PROVIDER-01` state before any network
 * work: a configured endpoint is not an activation signal, and until the CRM
 * provider gate is active the whole path is present and inert.
 *
 * A topic another handler already owns is chained rather than rejected, which
 * is the composition the factory itself performs across its required handler
 * groups -- `core.invoices.create` already carries both the invoice dispatch
 * handler and the portal projection materializer.
 */
export function withRuntimeBoundAdapters(
  factory: ProductionWorkflowAdapterFactory,
  crmTransport: ProviderJsonTransport | undefined,
  bindRuntime: (db: RuntimeDatabase) => void = () => {},
): ProductionWorkflowAdapterFactory {
  return {
    async create(input) {
      bindRuntime(input.db);
      const bundle = await factory.create(input);
      if (!crmTransport) return bundle;
      const handlers = new Map(bundle.outboxHandlers);
      const runtime = new ProviderRuntime(
        new PersistedProviderGateStateStore(
          new DatabaseExternalGateService(input.db),
        ),
      );
      const guarded = new GuardedProviderJsonTransport(
        crmTransport,
        runtime,
        (request) => ({
          environment: input.environment.runtimeEnvironment,
          mode: "live",
          boundary: "provider_effect",
          requestId: `crm-projection:${request.idempotencyKey ?? request.operation}`,
          effectId: request.idempotencyKey ?? request.operation,
        }),
      );
      const crm = createCrmProjectionOutboxHandlers({
        projection: new OutboundCrmProjectionAdapter(
          new HttpCrmProviderClient(guarded),
        ),
        accounts: new DatabaseCrmAccountRecordStore(input.db),
      });
      for (const [topic, handler] of crm) {
        const existing = handlers.get(topic);
        handlers.set(
          topic,
          existing
            ? async (delivery) => {
                await existing(delivery);
                await handler(delivery);
              }
            : handler,
        );
      }
      return { ...bundle, outboxHandlers: handlers };
    },
  };
}
