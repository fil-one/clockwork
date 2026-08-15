import { z } from "zod";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

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

import type {
  ProductionWorkflowAdapterFactory,
  TriggerWorkerEnvironmentSource,
} from "./trigger-worker-bootstrap";
import type {
  CommercialArtifactParty,
  CommercialArtifactRenderer,
} from "../core/commercial-artifact-handler";
import type { CoreWorkflowTaskSubmitter } from "../core/outbox-handlers";
import type { DeletionCertificateRenderer } from "../offboarding/deletion-certificate-handler";
import { createProductionWorkflowAdapterFactory } from "./production-adapter-factory";

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
  source: TriggerWorkerEnvironmentSource,
  name: string,
  gate: string,
): string {
  const value = source[name]?.trim();
  if (!value)
    throw new WorkflowEnvironmentAdapterConfigurationError([name], [gate]);
  return value;
}

function json<T>(
  source: TriggerWorkerEnvironmentSource,
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

class TriggerCoreWorkflowTaskSubmitter implements CoreWorkflowTaskSubmitter {
  public async submit(
    input: Parameters<CoreWorkflowTaskSubmitter["submit"]>[0],
  ) {
    const idempotencyKey = await idempotencyKeys.create(input.idempotencyKey, {
      scope: "global",
    });
    return tasks.trigger(input.taskId, input.payload, { idempotencyKey });
  }
}

function transport(
  source: TriggerWorkerEnvironmentSource,
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

/** Builds the default Trigger worker composition exclusively from registered env inputs. */
export function createEnvironmentWorkflowAdapterFactory(
  source: TriggerWorkerEnvironmentSource,
  instrumentation?: RuntimeBoundaryInstrumentation,
  telemetry?: ClockworkTelemetry,
) {
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
    transport(
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
  const accountingTransport = transport(
    source,
    "ACCOUNTING_PROVIDER",
    "accounting",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const notificationTransport = transport(
    source,
    "NOTIFICATION_PROVIDER",
    "notifications",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const usageTransport = transport(
    source,
    "USAGE_PROVIDER",
    "usage",
    "EXT-PROVISION-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const provisioningTransport = transport(
    source,
    "PROVISIONING_PROVIDER",
    "provisioning",
    "EXT-PROVISION-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const screeningTransport = transport(
    source,
    "SCREENING_PROVIDER",
    "screening",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  // The slot P0-44 found missing. The projection port, its adapter and its fake
  // existed and nothing constructed them, so §15's one-way outbound sync had no
  // runtime caller at all. `required` throws naming EXT-PROVIDER-01 when the
  // endpoint or credential is absent, so a worker with no approved CRM does not
  // boot rather than booting with a silently dead projection.
  const crmTransport = transport(
    source,
    "CRM_PROVIDER",
    "crm",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const signatureTransport = transport(
    source,
    "SIGNATURE_PROVIDER",
    "signature",
    "EXT-LEGAL-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const evidenceTransport = transport(
    source,
    "EVIDENCE_PROVIDER",
    "evidence",
    "EXT-ACC-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  // The slot P0-61 found missing. `required` throws a
  // WorkflowEnvironmentAdapterConfigurationError naming EXT-TAX-01 when the
  // endpoint or credential is absent, so a worker with no approved tax engine
  // does not boot rather than booting and billing every customer net.
  const taxTransport = transport(
    source,
    "TAX_PROVIDER",
    "tax",
    "EXT-TAX-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const documentRendererTransport = transport(
    source,
    "DOCUMENT_RENDERER_PROVIDER",
    "document-renderer",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const workosMfaTransport = transport(
    source,
    "WORKOS_MFA_PROVIDER",
    "workos-mfa",
    "EXT-ACC-01",
    allowInsecureLocalhost,
    instrumentation,
    telemetry,
  );
  const stripe = new StripeFinanceGateway({
    apiKey: required(source, "STRIPE_SECRET_KEY", "EXT-ACC-01"),
  });
  const issuer = party(
    json(source, "PLATFORM_ISSUER_JSON", "EXT-LEGAL-01", PartySchema),
  );
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
    coreTaskSubmitter: new TriggerCoreWorkflowTaskSubmitter(),
    providers: {
      billing: {
        mode: "live",
        value: { billing: stripe, metering: stripe, adjustments: stripe },
        activationTest: activationTest("billing"),
      },
      accounting: {
        mode: "live",
        value: { sink: new HttpAccountingExportSink(accountingTransport) },
        activationTest: activationTest("accounting"),
      },
      notifications: {
        mode: "live",
        value: { client: notifications.client },
        activationTest: activationTest("notifications"),
      },
      usage: {
        mode: "live",
        value: { client: new HttpUsageProviderClient(usageTransport) },
        activationTest: activationTest("usage"),
      },
      workos: {
        mode: "live",
        value: {
          client: new WorkosSdkOrganizationClient({
            apiKey: required(source, "WORKOS_API_KEY", "EXT-ACC-01"),
            mfaPolicyEnforcer: new HttpWorkosMfaPolicyEnforcer(
              workosMfaTransport,
            ),
          }),
        },
        activationTest: activationTest("workos"),
      },
      evidence: {
        mode: "live",
        value: evidence,
        activationTest: activationTest("evidence"),
      },
      provisioning: {
        mode: "live",
        value: { provider: new HttpProvisioningAdapter(provisioningTransport) },
        activationTest: activationTest("provisioning"),
      },
      screening: {
        mode: "live",
        value: {
          provider: new HttpLifecycleScreeningAdapter(screeningTransport),
        },
        activationTest: activationTest("screening"),
      },
      signature: {
        mode: "live",
        value: {
          provider: new HttpLifecycleSignatureAdapter(
            signatureTransport,
            json(
              source,
              "SIGNATURE_PROVIDER_SIGNING_ORIGINS_JSON",
              "EXT-LEGAL-01",
              z.array(z.url()).min(1).max(20),
            ),
          ),
        },
        activationTest: activationTest("signature"),
      },
      tax: {
        mode: "live",
        value: { provider: new HttpTaxAdapter(taxTransport) },
        activationTest: activationTest("tax"),
      },
    },
    deletionCertificates: {
      issuer,
      automatedTeardownEnabled: source.AUTOMATED_TEARDOWN_ENABLED === "true",
      renderer: renderers.deletion,
    },
    commercialArtifacts: {
      platformIssuer: issuer,
      renderer: renderers.commercial,
    },
  });
  return withRuntimeBoundAdapters(factory, crmTransport, notifications.bind);
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
  crmTransport: ProviderJsonTransport,
  bindRuntime: (db: RuntimeDatabase) => void = () => {},
): ProductionWorkflowAdapterFactory {
  return {
    async create(input) {
      bindRuntime(input.db);
      const bundle = await factory.create(input);
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
