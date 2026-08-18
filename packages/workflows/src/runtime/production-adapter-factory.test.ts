import { beforeAll, describe, expect, it, vi } from "vitest";

import { createRuntimeDatabase, WEBHOOK_REPLAY_TASK_ID } from "@clockwork/db";
import {
  evaluateExternalGate,
  type ExternalGateRecord,
  type ExternalGateActivationTestResult,
  type ExternalGateKey,
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
  FakeScreeningAdapter,
  FakeSignatureAdapter,
  FakeTaxAdapter,
} from "@clockwork/integrations/fakes";

import { lifecycleWorkflowRegistry } from "../lifecycle";
import { createLifecycleTaskOutboxHandlers } from "../system/lifecycle-task-dispatch";
import { productionTaskImporters } from "../trigger/discovery";
import {
  createProductionWorkflowAdapterFactory,
  PersistedWorkflowProviderActivationGuard,
  type ProductionWorkflowProviderSelections,
  type WorkflowProviderActivationGuard,
} from "./production-adapter-factory";

/**
 * Records what the Trigger SDK was actually asked to do, so registration and
 * submission are both observed rather than described. Every assertion about
 * the lifecycle registry below reads this, never a second hand-kept list.
 */
const sdk = vi.hoisted(() => ({
  registrations: [] as {
    id: string;
    scheduled: boolean;
    cron: string | undefined;
  }[],
  submissions: [] as { id: string; payload: unknown }[],
}));

vi.mock("@trigger.dev/sdk", () => {
  const define =
    (scheduled: boolean) =>
    (definition: { id: string; cron?: { pattern?: string } }) => {
      sdk.registrations.push({
        id: definition.id,
        scheduled,
        cron: definition.cron?.pattern,
      });
      return definition;
    };
  return {
    task: define(false),
    schedules: { task: define(true) },
    tasks: {
      trigger: (id: string, payload: unknown) => {
        sdk.submissions.push({ id, payload });
        return Promise.resolve({ id: `run_${sdk.submissions.length}` });
      },
    },
    idempotencyKeys: { create: (key: string) => Promise.resolve(key) },
  };
});

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
    screening: {
      mode: "simulator",
      value: { provider: new FakeScreeningAdapter(kernel) },
      activationTest: activationTest("screening"),
    },
    signature: {
      mode: "simulator",
      value: { provider: new FakeSignatureAdapter(kernel) },
      activationTest: activationTest("signature"),
    },
    tax: {
      mode: "simulator",
      value: { provider: new FakeTaxAdapter(kernel) },
      activationTest: activationTest("tax"),
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
    expect(
      bundle.outboxHandlers.has("experience.projection_action.queued"),
    ).toBe(true);
    expect(bundle.outboxHandlers.has("core.quotes.expire")).toBe(true);
    expect(bundle.outboxHandlers.has("core.orders.create")).toBe(true);
    expect(
      bundle.outboxHandlers.has("core.commission_statement.generated"),
    ).toBe(true);
    expect(bundle.outboxHandlers.has("core.commission_statement.settled")).toBe(
      true,
    );
    expect(
      bundle.outboxHandlers.has("experience.projection_action.applied"),
    ).toBe(true);
    expect(
      bundle.outboxHandlers.has("experience.projection.materialized"),
    ).toBe(true);
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

describe("persisted activation bootstrap preflight", () => {
  it("allows the bounded runner to refresh stale persisted evidence before active enforcement", async () => {
    const staleRecord: ExternalGateRecord = {
      id: "90000000-0000-4000-8000-000000000001",
      gateKey: "EXT-ACC-01",
      title: "Hosted accounts",
      owner: "Platform owner",
      inputRequired: "Scoped live provider account",
      affectedFeature: "Runtime",
      severity: "path_blocker",
      configuredStatus: "active",
      simulatorState: "ready",
      simulatorDetails: "Previous bounded probe passed",
      inputProvenance: "live_signed",
      lastActivationTestStatus: "passed",
      lastActivationTestAt: "2026-07-29T16:00:00.000Z",
      lastActivationTestedBy: "previous-runner",
      activationEvidenceReference: "evidence://activation/previous",
      reviewOn: "2099-12-31",
      statusReason: "Configured for activation refresh",
      emergencyDisabledAt: null,
      emergencyDisabledBy: null,
      emergencyDisableReason: null,
      emergencyDisableEvidenceReference: null,
      rowVersion: 3,
      updatedAt: "2026-07-29T16:00:00.000Z",
    };
    let persisted = evaluateExternalGate(staleRecord, now);
    const reader = {
      list: () => Promise.resolve([persisted]),
    };
    const guard = new PersistedWorkflowProviderActivationGuard(
      undefined as never,
      () => now,
      reader,
    );
    await expect(
      guard.requireConfiguredForActivation(["EXT-ACC-01"], "preflight"),
    ).resolves.toBeUndefined();
    await expect(
      guard.requireActive(["EXT-ACC-01"], "before-refresh"),
    ).rejects.toThrow("WORKFLOW_EXTERNAL_GATE_INACTIVE:EXT-ACC-01");
    persisted = evaluateExternalGate(
      {
        ...staleRecord,
        lastActivationTestAt: now.toISOString(),
        lastActivationTestedBy: "bounded-http-probe",
        activationEvidenceReference: "evidence://activation/current",
        rowVersion: 4,
        updatedAt: now.toISOString(),
      },
      now,
    );
    await expect(
      guard.requireActive(["EXT-ACC-01"], "after-refresh"),
    ).resolves.toBeUndefined();
  });
});

/**
 * The composition claim, bound to behaviour.
 *
 * Ten lifecycle effects once ran inline inside the one-minute outbox cron
 * because the dispatcher's submission port defaulted to executing them, and
 * the factory called it with no argument. A list saying which task each topic
 * maps to could not see that, so this drives the bundle production builds and
 * watches the Trigger boundary: an effect that never reaches `tasks.trigger`
 * has no durable run, no retry policy and no queue.
 */
describe("every lifecycle registry identifier reaches tasks.trigger", () => {
  const reached = new Map<string, string>();

  beforeAll(async () => {
    for (const importTasks of productionTaskImporters) await importTasks();

    const bundle = await withDatabase((db) =>
      createProductionWorkflowAdapterFactory({
        authorizationSecret: "test-authorization-context-secret",
        coreTaskSubmitter: { submit: () => Promise.resolve({ id: "run-1" }) },
        providers: selections(),
        exceptionRouting: routing(),
        activationGuard: new RecordingGuard(),
        clock: () => now,
      }).create({
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

    // The dispatcher names its own topics; the handlers driven are the bundle's.
    const topics = [
      ...createLifecycleTaskOutboxHandlers({
        submit: () => Promise.resolve(),
      }).keys(),
    ];
    let index = 0;
    for (const topic of topics) {
      const handler = bundle.outboxHandlers.get(topic);
      expect(handler, `${topic} is not composed into the bundle`).toBeDefined();
      index += 1;
      const messageId = `10000000-0000-4000-8000-${`${index}`.padStart(12, "0")}`;
      const before = sdk.submissions.length;
      // A topic the core lane also subscribes to runs its handler after this
      // one and rejects the lifecycle envelope; the submission it is chained
      // behind has already happened, which is what is being measured.
      await handler?.({
        messageId,
        eventId: `event-${messageId}`,
        topic,
        idempotencyKey: `outbox:${messageId}`,
        payload: {
          eventType: topic,
          aggregateType: "aggregate",
          aggregateId: `aggregate-${messageId}`,
          aggregateVersion: 1,
          data: {},
        },
      }).catch(() => undefined);
      for (const submission of sdk.submissions.slice(before))
        reached.set(submission.id, topic);
    }
  });

  it("registers each registry identifier exactly once with the SDK", () => {
    const registered = sdk.registrations
      .filter((registration) =>
        (lifecycleWorkflowRegistry as readonly string[]).includes(
          registration.id,
        ),
      )
      .map(({ id }) => id);
    expect(registered.sort()).toEqual([...lifecycleWorkflowRegistry].sort());
  });

  it("registers the worker-backed webhook replay task exactly once", () => {
    expect(
      sdk.registrations.filter(
        (registration) => registration.id === WEBHOOK_REPLAY_TASK_ID,
      ),
    ).toHaveLength(1);
  });

  it("submits every event-driven identifier through the production bundle", () => {
    const eventDriven = sdk.registrations
      .filter(
        (registration) =>
          !registration.scheduled &&
          (lifecycleWorkflowRegistry as readonly string[]).includes(
            registration.id,
          ),
      )
      .map(({ id }) => id)
      .sort();
    expect(eventDriven).toHaveLength(10);
    expect([...reached.keys()].sort()).toEqual(eventDriven);
  });

  it("fires every remaining identifier from its own schedule", () => {
    const orphaned = sdk.registrations.filter(
      (registration) =>
        (lifecycleWorkflowRegistry as readonly string[]).includes(
          registration.id,
        ) &&
        !reached.has(registration.id) &&
        !registration.cron?.trim(),
    );
    expect(orphaned.map(({ id }) => id)).toEqual([]);
  });

  it("opens one durable run per effect rather than one per cron drain", () => {
    const lifecycle = sdk.submissions.filter((submission) =>
      (lifecycleWorkflowRegistry as readonly string[]).includes(submission.id),
    );
    expect(lifecycle).toHaveLength(reached.size);
    expect(new Set(lifecycle.map(({ id }) => id)).size).toBe(lifecycle.length);
    for (const submission of lifecycle)
      expect(
        (submission.payload as { idempotencyKey?: unknown }).idempotencyKey,
      ).toMatch(/^outbox:10000000-0000-4000-8000-\d{12}$/);
  });
});

describe("provider activation failures keep their cause", () => {
  it("reports the probe's own error under the typed activation failure", async () => {
    const providers = selections();
    const transport = new Error("activation probe transport refused");
    providers.notifications.activationTest = () => Promise.reject(transport);
    const factory = createProductionWorkflowAdapterFactory({
      authorizationSecret: "test-authorization-context-secret",
      coreTaskSubmitter: { submit: () => Promise.resolve({ id: "run-1" }) },
      providers,
      exceptionRouting: routing(),
      activationGuard: new RecordingGuard(),
      clock: () => now,
    });
    const thrown: unknown = await withDatabase((db) =>
      factory
        .create({
          db,
          environment: {
            runtimeEnvironment: "test",
            directDatabaseUrl:
              "postgresql://clockwork:clockwork@127.0.0.1:54322/clockwork",
            triggerProjectRef: "proj_clockwork_test",
            triggerSecretKey: "tr_clockwork_test_secret",
          },
          source: {},
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        ),
    );
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(
      "WORKFLOW_PROVIDER_ACTIVATION_TEST_FAILED:notifications",
    );
    expect((thrown as Error).cause).toBe(transport);
  });
});
