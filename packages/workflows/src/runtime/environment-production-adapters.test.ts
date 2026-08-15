import { crmProjectionTopics } from "@clockwork/integrations";
import type { RuntimeDatabase } from "@clockwork/db";
import { describe, expect, it, vi } from "vitest";

import {
  createEnvironmentWorkflowAdapterFactory,
  createRuntimeBoundNotificationClient,
  withRuntimeBoundAdapters,
  WorkflowEnvironmentAdapterConfigurationError,
} from "./environment-production-adapters";
import type {
  ProductionWorkflowAdapterBundle,
  ProductionWorkflowAdapterFactory,
  TriggerWorkerEnvironment,
} from "./trigger-worker-bootstrap";
import type { ProviderJsonTransport } from "@clockwork/integrations";
import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

const completeEnvironment = {
  NODE_ENV: "test",
  AUTHORIZATION_CONTEXT_SECRET: "test-authorization-context-secret",
  WORKFLOW_PROVIDER_CONTROL_BASE_URL: "https://control.example/",
  WORKFLOW_PROVIDER_CONTROL_TOKEN: "control-token",
  ACCOUNTING_PROVIDER_BASE_URL: "https://accounting.example/",
  ACCOUNTING_PROVIDER_TOKEN: "accounting-token",
  NOTIFICATION_PROVIDER_BASE_URL: "https://notifications.example/",
  NOTIFICATION_PROVIDER_TOKEN: "notification-token",
  USAGE_PROVIDER_BASE_URL: "https://usage.example/",
  USAGE_PROVIDER_TOKEN: "usage-token",
  PROVISIONING_PROVIDER_BASE_URL: "https://provisioning.example/",
  PROVISIONING_PROVIDER_TOKEN: "provisioning-token",
  SCREENING_PROVIDER_BASE_URL: "https://screening.example/",
  SCREENING_PROVIDER_TOKEN: "screening-token",
  CRM_PROVIDER_BASE_URL: "https://crm.example/",
  CRM_PROVIDER_TOKEN: "crm-token",
  SIGNATURE_PROVIDER_BASE_URL: "https://signature.example/",
  SIGNATURE_PROVIDER_TOKEN: "signature-token",
  SIGNATURE_PROVIDER_SIGNING_ORIGINS_JSON: JSON.stringify([
    "https://signing.example",
  ]),
  EVIDENCE_PROVIDER_BASE_URL: "https://evidence.example/",
  EVIDENCE_PROVIDER_TOKEN: "evidence-token",
  TAX_PROVIDER_BASE_URL: "https://tax.example/",
  TAX_PROVIDER_TOKEN: "tax-token",
  DOCUMENT_RENDERER_PROVIDER_BASE_URL: "https://documents.example/",
  DOCUMENT_RENDERER_PROVIDER_TOKEN: "document-renderer-token",
  WORKOS_MFA_PROVIDER_BASE_URL: "https://workos-policy.example/",
  WORKOS_MFA_PROVIDER_TOKEN: "workos-policy-token",
  STRIPE_SECRET_KEY: "sk_test_clockwork_provider",
  WORKOS_API_KEY: "sk_test_workos_provider",
  PLATFORM_ISSUER_JSON: JSON.stringify({
    legalName: "Fil One, Inc.",
    address: {
      line1: "1 Commerce Way",
      locality: "New York",
      postalCode: "10001",
      countryCode: "US",
    },
  }),
  WORKFLOW_EXCEPTION_ROUTES_JSON: JSON.stringify([
    {
      queue: "reporting",
      accountId: "10000000-0000-4000-8000-000000000001",
      ownerUserId: "20000000-0000-4000-8000-000000000001",
      backupUserId: "20000000-0000-4000-8000-000000000002",
      objectType: "workflow_exception",
      targetMinutes: 60,
    },
  ]),
};

describe("environment production workflow adapters", () => {
  it("builds the default live adapter factory from complete registered inputs", () => {
    expect(() =>
      createEnvironmentWorkflowAdapterFactory(completeEnvironment),
    ).not.toThrow();
  });

  it("does not accept queue-to-account ownership from environment state", () => {
    const withoutStaticRoutes = {
      ...completeEnvironment,
      WORKFLOW_EXCEPTION_ROUTES_JSON: undefined,
    };
    expect(() =>
      createEnvironmentWorkflowAdapterFactory(withoutStaticRoutes),
    ).not.toThrow();
  });

  it("fails closed with the exact external input and gate", () => {
    let failure: unknown;
    try {
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        EVIDENCE_PROVIDER_TOKEN: undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      WorkflowEnvironmentAdapterConfigurationError,
    );
    if (!(failure instanceof WorkflowEnvironmentAdapterConfigurationError))
      throw new Error("Expected environment configuration failure");
    expect(failure.missing).toEqual(["EVIDENCE_PROVIDER_TOKEN"]);
    expect(failure.externalGates).toEqual(["EXT-ACC-01"]);
  });

  // P0-61: the composition had no tax slot at all, so there was nothing for an
  // absent tax engine to fail on and every invoice was written net. It now
  // fails closed on the exact absent input and names the gate that supplies it.
  it("fails closed on the tax provider under EXT-TAX-01", () => {
    let failure: unknown;
    try {
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        TAX_PROVIDER_BASE_URL: undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      WorkflowEnvironmentAdapterConfigurationError,
    );
    if (!(failure instanceof WorkflowEnvironmentAdapterConfigurationError))
      throw new Error("Expected environment configuration failure");
    expect(failure.missing).toEqual(["TAX_PROVIDER_BASE_URL"]);
    expect(failure.externalGates).toEqual(["EXT-TAX-01"]);
  });

  // P0-44: there was no CRM slot at all, so the projection port, its adapter
  // and its fake were unreachable from any composition and an absent CRM
  // endpoint was indistinguishable from a configured one.
  it("fails closed on the CRM provider under EXT-PROVIDER-01", () => {
    let failure: unknown;
    try {
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        CRM_PROVIDER_TOKEN: undefined,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(
      WorkflowEnvironmentAdapterConfigurationError,
    );
    if (!(failure instanceof WorkflowEnvironmentAdapterConfigurationError))
      throw new Error("Expected environment configuration failure");
    expect(failure.missing).toEqual(["CRM_PROVIDER_TOKEN"]);
    expect(failure.externalGates).toEqual(["EXT-PROVIDER-01"]);
  });

  it("never enables provider simulators in production discovery", () => {
    expect(() =>
      createEnvironmentWorkflowAdapterFactory({
        ...completeEnvironment,
        NODE_ENV: "production",
        CLOCKWORK_ENABLE_SIMULATORS: "true",
      }),
    ).toThrow("CLOCKWORK_ENABLE_SIMULATORS:production_forbidden");
  });
});

/**
 * The composition, not the port. P0-44's finding was that
 * `OutboundCrmProjectionAdapter` had zero importers: a projection with no
 * outbox consumer registered on the bundle is indistinguishable from no
 * projection at all, so these assert the registration rather than the mapping.
 */
describe("outbound CRM projection consumer composition", () => {
  const environment: TriggerWorkerEnvironment = {
    runtimeEnvironment: "test",
    directDatabaseUrl:
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    triggerProjectRef: "proj_test",
    triggerSecretKey: "tr_test_secret_key",
  };
  const transport: ProviderJsonTransport = {
    request: () =>
      Promise.reject(new Error("CRM transport must not be called")),
  };

  function composed(existing: ReadonlyMap<string, OutboxTopicHandler>) {
    const inner: ProductionWorkflowAdapterFactory = {
      create: () =>
        Promise.resolve({
          outboxHandlers: existing,
        } as unknown as ProductionWorkflowAdapterBundle),
    };
    return withRuntimeBoundAdapters(inner, transport).create({
      db: {} as unknown as RuntimeDatabase,
      environment,
      source: completeEnvironment,
    });
  }

  it("registers a handler for every projected commerce topic", async () => {
    const bundle = await composed(new Map());
    for (const topic of crmProjectionTopics)
      expect(bundle.outboxHandlers.has(topic)).toBe(true);
  });

  it("chains behind a topic another handler already owns", async () => {
    const owner = vi.fn<OutboxTopicHandler>().mockResolvedValue(undefined);
    const bundle = await composed(new Map([["core.orders.create", owner]]));
    const handler = bundle.outboxHandlers.get("core.orders.create");
    if (!handler) throw new Error("composed handler expected");
    // The CRM leg denies on persisted gate state before it reaches the
    // transport, which is exactly the inert-but-ready production posture; what
    // matters here is that the existing owner still ran first.
    await expect(
      handler({
        messageId: "44444444-4444-4444-8444-444444444401",
        eventId: "55555555-5555-4555-8555-555555555401",
        topic: "core.orders.create",
        idempotencyKey: "outbox:44444444-4444-4444-8444-444444444401",
        payload: {
          eventId: "55555555-5555-4555-8555-555555555401",
          eventType: "core.orders.create",
          aggregateType: "order",
          aggregateId: "66666666-6666-4666-8666-666666666401",
          aggregateVersion: 1,
          data: {},
        },
      }),
    ).rejects.toThrow();
    expect(owner).toHaveBeenCalledTimes(1);
  });
});

/**
 * `CoreNotificationAdapter` -- the adapter this composition hands the client to
 * -- passes a hard-coded first-party brand on every message. The only place that
 * can be corrected is the client the composition selects, so these assert the
 * selection rather than the branding rule.
 */
describe("runtime-bound notification delivery client", () => {
  const transport: ProviderJsonTransport = {
    request: () =>
      Promise.reject(new Error("notification transport must not be called")),
  };
  const message = {
    template: "renewals.term_end.v1",
    recipient: "client@juniper.test",
    data: { subjectId: "8f2c0d3e-0000-4000-8000-00000000000a" },
    brand: {
      kind: "fil_one" as const,
      displayName: "Fil One",
      fromDomain: "notifications.fil.one",
    },
    idempotencyKey: "notifications:composition:contract:0001",
  };

  it("refuses to send under the first-party sender before the tenant directory exists", async () => {
    const { client } = createRuntimeBoundNotificationClient(transport);
    await expect(client.send(message)).rejects.toThrow(
      "NOTIFICATION_TENANT_DIRECTORY_UNBOUND",
    );
  });

  it("binds the directory to the runtime handle the factory is created against", async () => {
    const bind = vi.fn<(db: RuntimeDatabase) => void>();
    const db = {} as unknown as RuntimeDatabase;
    const inner: ProductionWorkflowAdapterFactory = {
      create: () =>
        Promise.resolve({
          outboxHandlers: new Map(),
        } as unknown as ProductionWorkflowAdapterBundle),
    };
    await withRuntimeBoundAdapters(inner, transport, bind).create({
      db,
      environment: {
        runtimeEnvironment: "test",
        directDatabaseUrl:
          "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        triggerProjectRef: "proj_test",
        triggerSecretKey: "tr_test_secret_key",
      },
      source: completeEnvironment,
    });
    expect(bind).toHaveBeenCalledWith(db);
  });
});
