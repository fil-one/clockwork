import { z } from "zod";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import type { WorkflowExceptionRouting } from "@clockwork/db";
import {
  FetchJsonProviderTransport,
  HttpAccountingExportSink,
  HttpCoreEvidenceStorageAdapter,
  HttpLifecycleEvidenceStorageAdapter,
  HttpNotificationProviderClient,
  HttpProviderActivationTestClient,
  HttpProvisioningAdapter,
  HttpUsageProviderClient,
  HttpWorkosMfaPolicyEnforcer,
  StripeFinanceGateway,
  WorkosSdkOrganizationClient,
} from "@clockwork/integrations";

import type { TriggerWorkerEnvironmentSource } from "./trigger-worker-bootstrap";
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

function documentRenderers(rendererTransport: FetchJsonProviderTransport): {
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

const ExceptionRoutesSchema = z.array(
  z.object({
    queue: z.string().min(1),
    accountId: z.uuid(),
    ownerUserId: z.uuid(),
    backupUserId: z.uuid().optional(),
    objectType: z.string().min(1),
    targetMinutes: z.number().int().min(1).max(43_200),
  }),
);

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

class ConfiguredWorkflowExceptionRouting implements WorkflowExceptionRouting {
  private readonly routes: ReadonlyMap<
    string,
    z.output<typeof ExceptionRoutesSchema>[number]
  >;

  public constructor(routes: z.output<typeof ExceptionRoutesSchema>) {
    this.routes = new Map(routes.map((route) => [route.queue, route]));
    if (this.routes.size !== routes.length)
      throw new WorkflowEnvironmentAdapterConfigurationError(
        ["WORKFLOW_EXCEPTION_ROUTES_JSON:duplicate_queue"],
        ["EXT-APPROVERS-01"],
      );
  }

  public resolve(input: {
    queue: string;
    aggregateId: string;
    occurredAt: string;
    severity: "warning" | "blocking";
  }) {
    const route = this.routes.get(input.queue);
    if (!route)
      return Promise.reject(
        new Error(`WORKFLOW_EXCEPTION_ROUTE_NOT_CONFIGURED:${input.queue}`),
      );
    return Promise.resolve({
      accountId: route.accountId,
      ownerUserId: route.ownerUserId,
      ...(route.backupUserId ? { backupUserId: route.backupUserId } : {}),
      objectType: route.objectType,
      targetAt: new Date(
        Date.parse(input.occurredAt) + route.targetMinutes * 60_000,
      ).toISOString(),
    });
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
) {
  return new FetchJsonProviderTransport({
    baseUrl: required(source, `${prefix}_BASE_URL`, gate),
    bearerToken: required(source, `${prefix}_TOKEN`, gate),
    provider,
    allowInsecureLocalhost,
  });
}

/** Builds the default Trigger worker composition exclusively from registered env inputs. */
export function createEnvironmentWorkflowAdapterFactory(
  source: TriggerWorkerEnvironmentSource,
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
    ),
  );
  const activationTest = (provider: string) => () => control.run(provider);
  const accountingTransport = transport(
    source,
    "ACCOUNTING_PROVIDER",
    "accounting",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
  );
  const notificationTransport = transport(
    source,
    "NOTIFICATION_PROVIDER",
    "notifications",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
  );
  const usageTransport = transport(
    source,
    "USAGE_PROVIDER",
    "usage",
    "EXT-PROVISION-01",
    allowInsecureLocalhost,
  );
  const provisioningTransport = transport(
    source,
    "PROVISIONING_PROVIDER",
    "provisioning",
    "EXT-PROVISION-01",
    allowInsecureLocalhost,
  );
  const evidenceTransport = transport(
    source,
    "EVIDENCE_PROVIDER",
    "evidence",
    "EXT-ACC-01",
    allowInsecureLocalhost,
  );
  const documentRendererTransport = transport(
    source,
    "DOCUMENT_RENDERER_PROVIDER",
    "document-renderer",
    "EXT-PROVIDER-01",
    allowInsecureLocalhost,
  );
  const workosMfaTransport = transport(
    source,
    "WORKOS_MFA_PROVIDER",
    "workos-mfa",
    "EXT-ACC-01",
    allowInsecureLocalhost,
  );
  const stripe = new StripeFinanceGateway({
    apiKey: required(source, "STRIPE_SECRET_KEY", "EXT-ACC-01"),
  });
  const issuer = party(
    json(source, "PLATFORM_ISSUER_JSON", "EXT-LEGAL-01", PartySchema),
  );
  const renderers = documentRenderers(documentRendererTransport);
  const exceptionRouting = new ConfiguredWorkflowExceptionRouting(
    json(
      source,
      "WORKFLOW_EXCEPTION_ROUTES_JSON",
      "EXT-APPROVERS-01",
      ExceptionRoutesSchema,
    ),
  );
  const evidence = {
    core: new HttpCoreEvidenceStorageAdapter(evidenceTransport),
    lifecycle: new HttpLifecycleEvidenceStorageAdapter(evidenceTransport),
  };
  return createProductionWorkflowAdapterFactory({
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
        value: {
          client: new HttpNotificationProviderClient(notificationTransport),
        },
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
    },
    exceptionRouting,
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
}
