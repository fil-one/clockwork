import { describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "@clockwork/db";
import type {
  ExternalGateActivationTestResult,
  ExternalGateKey,
} from "@clockwork/domain/system";
import {
  FakeEvidenceStorageAdapter as LifecycleFakeEvidenceStorageAdapter,
  InMemoryAccountingExportSink,
  type WorkosClient,
} from "@clockwork/integrations";
import {
  FakeBillingAdapter,
  FakeEvidenceStorageAdapter as CoreFakeEvidenceStorageAdapter,
  FakeProviderKernel,
  FakeProvisioningAdapter,
} from "@clockwork/integrations/fakes";

import { lifecycleWorkflowRegistry } from "../lifecycle";
import {
  createProductionWorkflowAdapterFactory,
  type ProductionWorkflowProviderSelections,
  type WorkflowProviderActivationGuard,
} from "./production-adapter-factory";

const now = new Date("2026-07-31T16:00:00.000Z");

function activationTest(
  provider: string,
  testedAt = now.toISOString(),
): () => Promise<ExternalGateActivationTestResult> {
  return () =>
    Promise.resolve({
      status: "passed",
      testedAt,
      testedBy: "provider-contract-test",
      evidenceReference: `urn:clockwork:activation:${provider}`,
      simulatorState: "ready",
      simulatorDetails: `${provider} ready`,
      inputProvenance: "repository_fixture",
    });
}

function selections(): ProductionWorkflowProviderSelections {
  const kernel = new FakeProviderKernel();
  const billing = new FakeBillingAdapter(kernel);
  const workos: WorkosClient = {
    createOrganization: () => Promise.resolve({ id: "workos-org-1" }),
    addVerifiedDomain: () => Promise.resolve({ verified: true }),
    updateMfaPolicy: () => Promise.resolve(),
    createInvitation: () =>
      Promise.resolve({ id: "workos-invitation-1", state: "pending" }),
    listMemberships: () => Promise.resolve([]),
    getOrganization: ({ organizationId }) =>
      Promise.resolve({
        id: organizationId,
        name: "Example",
        externalId: "00000000-0000-4000-8000-000000000001",
        verifiedDomains: ["example.com"],
        mfaPolicy: "required",
      }),
  };
  return {
    billing: {
      mode: "simulator",
      value: {
        billing,
        metering: {
          syncOverage: (input) =>
            Promise.resolve({
              ok: true,
              value: {
                providerInvoiceItemIds: input.lines.map(
                  (line) => `item:${line.ledgerEntryId}`,
                ),
                duplicateSourceUsageIds: [],
              },
            }),
        },
        adjustments: {
          issueCreditNote: () =>
            Promise.resolve({
              ok: true,
              value: { creditNoteId: "cn_simulator", status: "issued" },
            }),
          refundPayment: () =>
            Promise.resolve({
              ok: true,
              value: { refundId: "re_simulator", status: "pending" },
            }),
        },
      },
      activationTest: activationTest("billing"),
    },
    accounting: {
      mode: "simulator",
      value: { sink: new InMemoryAccountingExportSink() },
      activationTest: activationTest("accounting"),
    },
    notifications: {
      mode: "simulator",
      value: {
        client: {
          send: (input) =>
            Promise.resolve({ messageId: `message:${input.idempotencyKey}` }),
        },
      },
      activationTest: activationTest("notifications"),
    },
    usage: {
      mode: "simulator",
      value: { client: { pull: () => Promise.resolve({ records: [] }) } },
      activationTest: activationTest("usage"),
    },
    workos: {
      mode: "simulator",
      value: { client: workos },
      activationTest: activationTest("workos"),
    },
    evidence: {
      mode: "simulator",
      value: {
        core: new CoreFakeEvidenceStorageAdapter(kernel),
        lifecycle: new LifecycleFakeEvidenceStorageAdapter(),
      },
      activationTest: activationTest("evidence"),
    },
    provisioning: {
      mode: "simulator",
      value: { provider: new FakeProvisioningAdapter(kernel) },
      activationTest: activationTest("provisioning"),
    },
  };
}

class RecordingGuard implements WorkflowProviderActivationGuard {
  public readonly checks: {
    gateKeys: readonly ExternalGateKey[];
    requestId: string;
  }[] = [];

  public requireActive(
    gateKeys: readonly ExternalGateKey[],
    requestId: string,
  ): Promise<void> {
    this.checks.push({ gateKeys: [...gateKeys], requestId });
    return Promise.resolve();
  }
}

function routing() {
  return {
    resolve: () =>
      Promise.resolve({
        accountId: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "00000000-0000-4000-8000-000000000002",
        backupUserId: "00000000-0000-4000-8000-000000000003",
        objectType: "workflow_exception",
        targetAt: "2026-08-01T16:00:00.000Z",
      }),
  };
}

async function withDatabase<T>(
  operation: (db: ReturnType<typeof createRuntimeDatabase>["db"]) => Promise<T>,
): Promise<T> {
  const runtime = createRuntimeDatabase({
    url: "postgresql://clockwork:clockwork@127.0.0.1:54322/clockwork",
    role: "clockwork_service",
  });
  try {
    return await operation(runtime.db);
  } finally {
    await runtime.client.end();
  }
}

describe("production workflow adapter factory", () => {
  it("builds every adapter and lifecycle handler for staging simulators", async () => {
    const guard = new RecordingGuard();
    const factory = createProductionWorkflowAdapterFactory({
      authorizationSecret: "test-authorization-context-secret",
      coreTaskSubmitter: { submit: () => Promise.resolve({ id: "run-1" }) },
      providers: selections(),
      exceptionRouting: routing(),
      activationGuard: guard,
      clock: () => now,
      commercialArtifacts: {
        renderer: {
          render: () =>
            Promise.resolve({
              bytes: new Uint8Array([37, 80, 68, 70]),
              contentHash: "a".repeat(64),
              recordHash: "b".repeat(64),
              documentId: "DOC-1",
              version: "1",
              mimeType: "application/pdf",
            }),
        },
        platformIssuer: {
          legalName: "Fil One, Inc.",
          address: {
            line1: "1 Commerce Way",
            locality: "New York",
            postalCode: "10001",
            countryCode: "US",
          },
        },
      },
    });
    const bundle = await withDatabase((db) =>
      factory.create({
        db,
        environment: {
          runtimeEnvironment: "test",
          directDatabaseUrl:
            "postgresql://clockwork:clockwork@127.0.0.1:54322/clockwork",
          triggerProjectRef: "proj_clockwork_test",
          triggerSecretKey: "tr_clockwork_test_secret",
        },
        source: {},
      }),
    );

    expect([...bundle.lifecycleHandlers.keys()].sort()).toEqual(
      [...lifecycleWorkflowRegistry].sort(),
    );
    expect(bundle.coreProviders.billing).toBeDefined();
    expect(bundle.coreProviders.metering).toBeDefined();
    expect(bundle.coreProviders.accounting).toBeDefined();
    expect(bundle.coreProviders.notifications).toBeDefined();
    expect(bundle.coreProviders.usage).toBeDefined();
    expect(bundle.coreProviders.exports).toBeDefined();
    expect(bundle.commercialArtifacts?.platformIssuer.legalName).toBe(
      "Fil One, Inc.",
    );
    expect(bundle.outboxHandlers.has("core.invoice.draft_ready")).toBe(true);
    expect(bundle.outboxHandlers.has("core.schedule.dispatch.v1")).toBe(true);
    expect(guard.checks[0]?.gateKeys).toEqual([
      "EXT-ACC-01",
      "EXT-COMMERCIAL-01",
      "EXT-PROVIDER-01",
      "EXT-PROVISION-01",
      "EXT-TAX-01",
      "EXT-APPROVERS-01",
      "EXT-LEGAL-01",
    ]);
  });

  it("forbids every simulator selection in production", async () => {
    const factory = createProductionWorkflowAdapterFactory({
      authorizationSecret: "test-authorization-context-secret",
      coreTaskSubmitter: { submit: () => Promise.resolve({ id: "run-1" }) },
      providers: selections(),
      exceptionRouting: routing(),
      activationGuard: new RecordingGuard(),
      clock: () => now,
    });
    await expect(
      withDatabase((db) =>
        factory.create({
          db,
          environment: {
            runtimeEnvironment: "production",
            directDatabaseUrl: "postgresql://service@db.example/clockwork",
            triggerProjectRef: "proj_clockwork_production",
            triggerSecretKey: "tr_clockwork_production_secret",
          },
          source: {},
        }),
      ),
    ).rejects.toThrow("WORKFLOW_PRODUCTION_SIMULATOR_FORBIDDEN");
  });

  it("rejects stale provider activation tests", async () => {
    const providers = selections();
    providers.notifications.activationTest = activationTest(
      "notifications",
      "2026-07-29T16:00:00.000Z",
    );
    const factory = createProductionWorkflowAdapterFactory({
      authorizationSecret: "test-authorization-context-secret",
      coreTaskSubmitter: { submit: () => Promise.resolve({ id: "run-1" }) },
      providers,
      exceptionRouting: routing(),
      activationGuard: new RecordingGuard(),
      clock: () => now,
    });
    await expect(
      withDatabase((db) =>
        factory.create({
          db,
          environment: {
            runtimeEnvironment: "test",
            directDatabaseUrl:
              "postgresql://clockwork:clockwork@127.0.0.1:54322/clockwork",
            triggerProjectRef: "proj_clockwork_test",
            triggerSecretKey: "tr_clockwork_test_secret",
          },
          source: {},
        }),
      ),
    ).rejects.toThrow("WORKFLOW_PROVIDER_ACTIVATION_TEST_FAILED:notifications");
  });
});
