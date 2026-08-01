import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import { ProblemError } from "@clockwork/contracts";
import {
  EXTERNAL_GATE_ACTIVATION_TEST_MAX_AGE_MS,
  type ActivationTestRunner,
  type ExternalGateRecord,
} from "@clockwork/domain/system";

import { createApiApp } from "../../app";
import { LocalSessionResolver, sessionMiddleware } from "../../auth/session";
import type { ApiVariables } from "../../context";
import {
  idempotencyMiddleware,
  MemoryIdempotencyStore,
} from "../../middleware/idempotency";
import { requestContextMiddleware } from "../../middleware/request-context";
import { createCsrfAndOriginMiddleware } from "../../middleware/security";
import {
  type ExceptionRosterAdminService,
  type ExternalGateActivationTaskService,
  type ExternalGateAdministrationServices,
  type ExternalGateService,
  ExternalGateViewSchema,
  MemoryExternalGateService,
  registerExternalGateRoutes,
} from "./external-gates";

const csrf = "system-gate-csrf-token-00000000000001";
const gate: ExternalGateRecord = {
  id: "90000000-0000-4000-8000-000000000001",
  gateKey: "EXT-ACC-01",
  title: "Hosted accounts and credentials",
  owner: "Platform owner",
  inputRequired: "Scoped hosted credentials",
  affectedFeature: "Hosted runtime",
  severity: "path_blocker",
  configuredStatus: "blocked",
  simulatorState: "ready",
  simulatorDetails: "Provider simulator ready",
  inputProvenance: "unverified",
  lastActivationTestStatus: "never",
  lastActivationTestAt: null,
  lastActivationTestedBy: null,
  activationEvidenceReference: null,
  reviewOn: null,
  statusReason: "Production credentials pending",
  emergencyDisabledAt: null,
  emergencyDisabledBy: null,
  emergencyDisableReason: null,
  emergencyDisableEvidenceReference: null,
  rowVersion: 1,
  updatedAt: "2026-07-31T15:00:00Z",
};

function administrationApp(
  service: ExternalGateService,
  administration: ExternalGateAdministrationServices,
) {
  const app = new OpenAPIHono<{ Variables: ApiVariables }>();
  app.use("*", requestContextMiddleware);
  app.use("*", createCsrfAndOriginMiddleware());
  app.use("*", sessionMiddleware(new LocalSessionResolver()));
  app.use("*", idempotencyMiddleware(new MemoryIdempotencyStore()));
  app.onError((error, context) => {
    if (error instanceof ProblemError)
      return context.json(error.problem, error.problem.status as 500, {
        "content-type": "application/problem+json",
      });
    return context.json(
      {
        status: 500,
        code: "INTERNAL_ERROR",
        title: error.message,
      },
      500,
    );
  });
  registerExternalGateRoutes(app, service, undefined, administration);
  return app;
}

function headers(recent = true, key = "external-gate-update-0001") {
  return {
    "content-type": "application/json",
    origin: "http://localhost:3000",
    cookie: `clockwork-csrf=${csrf}`,
    "x-csrf-token": csrf,
    "idempotency-key": key,
    "x-clockwork-persona": "internal_operator",
    "x-clockwork-recent-auth": String(recent),
  };
}

function updateBody(configuredStatus: "active" | "blocked" = "blocked") {
  return {
    expectedRowVersion: 2,
    owner: "Platform owner",
    inputRequired: "Scoped hosted credentials and policy identifiers",
    configuredStatus,
    reviewOn: "2099-08-31",
    statusReason: "Staging activation and recovery checks completed",
  };
}

function runner(
  status: "passed" | "failed",
  options: { expired?: boolean; simulatorReady?: boolean } = {},
): ActivationTestRunner {
  return {
    run: ({ requestedAt, actor, gate: selectedGate }) =>
      Promise.resolve({
        status,
        testedAt: new Date(
          requestedAt.getTime() -
            (options.expired
              ? EXTERNAL_GATE_ACTIVATION_TEST_MAX_AGE_MS + 1
              : 0),
        ).toISOString(),
        testedBy: `runner:${actor.id}`,
        evidenceReference: `https://evidence.fil.one/activation/${selectedGate.gateKey}?signed=secret#download`,
        simulatorState: options.simulatorReady === false ? "degraded" : "ready",
        simulatorDetails:
          status === "passed"
            ? "All deterministic activation scenarios passed"
            : "Expected-denial scenario failed safely",
        inputProvenance: "repository_fixture",
      }),
  };
}

function activeGate(
  overrides: Partial<ExternalGateRecord> = {},
): ExternalGateRecord {
  const testedAt = new Date().toISOString();
  return {
    ...gate,
    configuredStatus: "active",
    inputProvenance: "live_signed",
    lastActivationTestStatus: "passed",
    lastActivationTestAt: testedAt,
    lastActivationTestedBy: "live-provider-runner",
    activationEvidenceReference: "evidence://activation/live-provider",
    reviewOn: "2099-08-31",
    statusReason: "Live provider activation and recovery checks completed",
    updatedAt: testedAt,
    ...overrides,
  };
}

function rosterBody(expectedRowVersion = 0) {
  return {
    expectedRowVersion,
    accountId: "10000000-0000-4000-8000-000000000001",
    queue: "provider_recovery",
    userId: "20000000-0000-4000-8000-000000000003",
    role: "primary",
    active: true,
    qualificationEvidenceReference:
      "https://evidence.fil.one/qualifications/operator-3?token=removed",
    qualifiedUntil: "2099-08-31T23:59:59.000Z",
    absentFrom: null,
    absentUntil: null,
    targetMinutes: 30,
    priority: 10,
  };
}

async function activationTest(
  app: ReturnType<typeof createApiApp>,
  expectedRowVersion = 1,
  recent = true,
) {
  return app.request("/v1/system/external-gates/EXT-ACC-01/activation-tests", {
    method: "POST",
    headers: headers(
      recent,
      `external-gate-test-${expectedRowVersion}-${recent}`,
    ),
    body: JSON.stringify({ expectedRowVersion }),
  });
}

describe("external-gate system API", () => {
  it("lists the persisted projection only for internal operators", async () => {
    const app = createApiApp({
      system: { externalGates: new MemoryExternalGateService([gate]) },
    });
    const allowed = await app.request("/v1/system/external-gates", {
      headers: { "x-clockwork-persona": "internal_operator" },
    });
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      items: [{ gateKey: "EXT-ACC-01", activationAllowed: false }],
    });
    const denied = await app.request("/v1/system/external-gates", {
      headers: { "x-clockwork-persona": "owner" },
    });
    expect(denied.status).toBe(403);
  });

  it("rejects forged activation evidence on the general update body", async () => {
    const service = new MemoryExternalGateService([gate]);
    const app = createApiApp({
      system: {
        externalGates: service,
        externalGateActivationTests: runner("passed"),
      },
    });
    const forged = await app.request("/v1/system/external-gates/EXT-ACC-01", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({
        ...updateBody("active"),
        expectedRowVersion: 1,
        simulatorState: "ready",
        simulatorDetails: "Operator claims the simulator passed",
        lastActivationTestStatus: "passed",
        lastActivationTestAt: new Date().toISOString(),
        lastActivationTestedBy: "operator-self-attestation",
        activationEvidenceReference: "evidence://forged/pass",
      }),
    });
    expect(forged.status).toBe(422);
    const projection = await service.get({
      gateKey: "EXT-ACC-01",
      requestId: "assert-forged-update",
      now: new Date(),
    });
    expect(projection).toMatchObject({
      configuredStatus: "blocked",
      lastActivationTestStatus: "never",
      activationAllowed: false,
      rowVersion: 1,
    });
  });

  it("requires recent authentication and a configured runner", async () => {
    const service = new MemoryExternalGateService([gate]);
    const withoutRunner = createApiApp({ system: { externalGates: service } });
    const unavailable = await activationTest(withoutRunner);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "EXTERNAL_GATE_ACTIVATION_RUNNER_UNAVAILABLE",
    });

    const withRunner = createApiApp({
      system: {
        externalGates: service,
        externalGateActivationTests: runner("passed"),
      },
    });
    const stale = await activationTest(withRunner, 1, false);
    expect(stale.status).toBe(403);
  });

  it("executes the selected runner and exposes every sanitized result field", async () => {
    const service = new MemoryExternalGateService([gate]);
    const app = createApiApp({
      system: {
        externalGates: service,
        externalGateActivationTests: runner("passed"),
      },
    });
    const executed = await activationTest(app);
    expect(executed.status).toBe(200);
    const result = ExternalGateViewSchema.parse(await executed.json());
    expect(result).toMatchObject({
      gateKey: "EXT-ACC-01",
      simulatorState: "ready",
      simulatorDetails: "All deterministic activation scenarios passed",
      inputProvenance: "repository_fixture",
      lastActivationTestStatus: "passed",
      activationEvidenceReference:
        "https://evidence.fil.one/activation/EXT-ACC-01",
      rowVersion: 2,
    });
    expect(result.lastActivationTestedBy).toMatch(/^runner:/);
    expect(result.lastActivationTestAt).toEqual(expect.any(String));

    const activated = await app.request(
      "/v1/system/external-gates/EXT-ACC-01",
      {
        method: "PUT",
        headers: headers(true, "external-gate-activate-after-runner"),
        body: JSON.stringify(updateBody("active")),
      },
    );
    expect(activated.status).toBe(200);
    await expect(activated.json()).resolves.toMatchObject({
      configuredStatus: "active",
      effectiveStatus: "active",
      activationAllowed: true,
      rowVersion: 3,
    });
  });

  it.each([
    ["failed", runner("failed"), "activation_test_not_passed"],
    ["expired", runner("passed", { expired: true }), "activation_test_expired"],
  ] as const)(
    "blocks activation after a %s executable result",
    async (_name, testRunner, reason) => {
      const service = new MemoryExternalGateService([gate]);
      const app = createApiApp({
        system: {
          externalGates: service,
          externalGateActivationTests: testRunner,
        },
      });
      const executed = await activationTest(app);
      expect(executed.status).toBe(200);
      const result = ExternalGateViewSchema.parse(await executed.json());
      expect(result).toMatchObject({
        activationAllowed: false,
        rowVersion: 2,
      });
      expect(result.blockedReasons).toContain(reason);
      const activate = await app.request(
        "/v1/system/external-gates/EXT-ACC-01",
        {
          method: "PUT",
          headers: headers(true, `external-gate-activate-${_name}`),
          body: JSON.stringify(updateBody("active")),
        },
      );
      expect(activate.status).toBe(422);
    },
  );

  it("downgrades a live-signed commercial gate after a fixture-only activation result", async () => {
    const commercial = activeGate({
      gateKey: "EXT-COMMERCIAL-01",
      title: "Signed commercial policy",
    });
    const service = new MemoryExternalGateService([commercial]);
    const result = await service.recordActivationTest({
      gateKey: "EXT-COMMERCIAL-01",
      expectedRowVersion: 1,
      result: {
        status: "passed",
        testedAt: new Date().toISOString(),
        testedBy: "repository-fixture-runner",
        evidenceReference: "evidence://activation/commercial-fixture",
        simulatorState: "ready",
        simulatorDetails: "Repository fixture completed",
        inputProvenance: "repository_fixture",
      },
      actor: {
        kind: "user",
        id: "20000000-0000-4000-8000-000000000001",
      },
      requestId: "commercial-fixture-result",
      now: new Date(),
    });
    expect(result).toMatchObject({
      configuredStatus: "blocked",
      effectiveStatus: "blocked",
      inputProvenance: "repository_fixture",
      activationAllowed: false,
    });
    expect(result.blockedReasons).toContain("live_signed_input_missing");
  });

  it("records an authenticated optimistic emergency disable and restore", async () => {
    const service = new MemoryExternalGateService([activeGate()]);
    const app = createApiApp({ system: { externalGates: service } });
    const disabled = await app.request(
      "/v1/system/external-gates/EXT-ACC-01/emergency-state",
      {
        method: "PUT",
        headers: headers(true, "external-gate-emergency-disable"),
        body: JSON.stringify({
          expectedRowVersion: 1,
          disabled: true,
          reason: "Provider integrity incident requires immediate isolation",
          evidenceReference:
            "https://evidence.fil.one/incidents/provider-1?secret=removed#download",
        }),
      },
    );
    expect(disabled.status).toBe(200);
    const disabledView = ExternalGateViewSchema.parse(await disabled.json());
    expect(disabledView).toMatchObject({
      configuredStatus: "active",
      effectiveStatus: "blocked",
      activationAllowed: false,
      emergencyDisabledBy: "20000000-0000-4000-8000-000000000001",
      emergencyDisableReason:
        "Provider integrity incident requires immediate isolation",
      emergencyDisableEvidenceReference:
        "https://evidence.fil.one/incidents/provider-1",
      rowVersion: 2,
    });
    expect(disabledView.blockedReasons).toContain("emergency_disabled");

    const stale = await app.request(
      "/v1/system/external-gates/EXT-ACC-01/emergency-state",
      {
        method: "PUT",
        headers: headers(true, "external-gate-emergency-stale"),
        body: JSON.stringify({
          expectedRowVersion: 1,
          disabled: false,
          reason: "Provider integrity incident has been fully resolved",
          evidenceReference: "evidence://incident/provider-1/resolved",
        }),
      },
    );
    expect(stale.status).toBe(409);

    const restored = await app.request(
      "/v1/system/external-gates/EXT-ACC-01/emergency-state",
      {
        method: "PUT",
        headers: headers(true, "external-gate-emergency-restore"),
        body: JSON.stringify({
          expectedRowVersion: 2,
          disabled: false,
          reason: "Provider integrity incident has been fully resolved",
          evidenceReference: "evidence://incident/provider-1/resolved",
        }),
      },
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      effectiveStatus: "active",
      activationAllowed: true,
      emergencyDisabledAt: null,
      emergencyDisabledBy: null,
      emergencyDisableReason: null,
      emergencyDisableEvidenceReference: null,
      rowVersion: 3,
    });
  });

  it("submits a version-bound durable activation task through the injected scheduler", async () => {
    const enqueue = vi.fn<ExternalGateActivationTaskService["enqueue"]>(
      (input) =>
        Promise.resolve({
          runId: "run-external-gate-activation-1",
          taskKey: input.taskKey,
          gateKey: input.gateKey,
          provider: input.provider,
          expectedGateRowVersion: input.expectedGateRowVersion,
          status: "queued",
          submittedAt: input.now.toISOString(),
        }),
    );
    const service = new MemoryExternalGateService([gate]);
    const app = administrationApp(service, {
      activationTasks: { enqueue },
    });
    const response = await app.request(
      "/v1/system/external-gates/EXT-ACC-01/activation-tasks",
      {
        method: "POST",
        headers: headers(true, "external-gate-durable-task-1"),
        body: JSON.stringify({
          expectedRowVersion: 1,
          taskKey: "external-gate:EXT-ACC-01:billing:2026-08-01",
          provider: "billing",
        }),
      },
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      runId: "run-external-gate-activation-1",
      gateKey: "EXT-ACC-01",
      expectedGateRowVersion: 1,
      status: "queued",
    });
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        gateKey: "EXT-ACC-01",
        expectedGateRowVersion: 1,
        idempotencyKey: "external-gate-durable-task-1",
        actor: {
          kind: "user",
          id: "20000000-0000-4000-8000-000000000001",
        },
      }),
    );

    const stale = await app.request(
      "/v1/system/external-gates/EXT-ACC-01/activation-tasks",
      {
        method: "POST",
        headers: headers(true, "external-gate-durable-task-stale"),
        body: JSON.stringify({
          expectedRowVersion: 2,
          taskKey: "external-gate:EXT-ACC-01:billing:2026-08-02",
          provider: "billing",
        }),
      },
    );
    expect(stale.status).toBe(409);
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("fails closed when durable activation or roster dependencies are absent", async () => {
    const app = administrationApp(new MemoryExternalGateService([gate]), {});
    const activation = await app.request(
      "/v1/system/external-gates/EXT-ACC-01/activation-tasks",
      {
        method: "POST",
        headers: headers(true, "external-gate-durable-task-missing"),
        body: JSON.stringify({
          expectedRowVersion: 1,
          taskKey: "external-gate:EXT-ACC-01:billing:2026-08-03",
          provider: "billing",
        }),
      },
    );
    expect(activation.status).toBe(503);
    await expect(activation.json()).resolves.toMatchObject({
      code: "EXTERNAL_GATE_ACTIVATION_TASK_SERVICE_UNAVAILABLE",
    });

    const roster = await app.request(
      "/v1/system/exception-roster/70000000-0000-4000-8000-000000000001",
      {
        method: "PUT",
        headers: headers(true, "exception-roster-missing"),
        body: JSON.stringify(rosterBody()),
      },
    );
    expect(roster.status).toBe(503);
    await expect(roster.json()).resolves.toMatchObject({
      code: "EXCEPTION_ROSTER_SERVICE_UNAVAILABLE",
    });
  });

  it("creates and updates roster assignments through the injected audited service", async () => {
    const upsert = vi.fn<ExceptionRosterAdminService["upsert"]>((input) =>
      Promise.resolve({
        id: input.rosterEntryId,
        accountId: input.accountId,
        queue: input.queue,
        userId: input.userId,
        role: input.role,
        active: input.active,
        qualificationEvidenceReference: input.qualificationEvidenceReference,
        qualifiedUntil: input.qualifiedUntil,
        absentFrom: input.absentFrom,
        absentUntil: input.absentUntil,
        targetMinutes: input.targetMinutes,
        priority: input.priority,
        rowVersion: input.expectedRowVersion + 1,
        updatedAt: input.now,
      }),
    );
    const reassignOpenCase = vi.fn<
      ExceptionRosterAdminService["reassignOpenCase"]
    >((input) =>
      Promise.resolve({
        id: input.caseId,
        accountId: "10000000-0000-4000-8000-000000000001",
        queue: "provider_recovery",
        status: "open",
        ownerUserId: "20000000-0000-4000-8000-000000000004",
        backupUserId: "20000000-0000-4000-8000-000000000005",
        targetAt: new Date(input.now.getTime() + 30 * 60_000),
        rowVersion: 4,
        updatedAt: input.now,
      }),
    );
    const app = administrationApp(new MemoryExternalGateService([gate]), {
      exceptionRoster: { upsert, reassignOpenCase },
    });
    const rosterEntryId = "70000000-0000-4000-8000-000000000001";
    const created = await app.request(
      `/v1/system/exception-roster/${rosterEntryId}`,
      {
        method: "PUT",
        headers: headers(true, "exception-roster-create-1"),
        body: JSON.stringify(rosterBody()),
      },
    );
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      id: rosterEntryId,
      queue: "provider_recovery",
      role: "primary",
      rowVersion: 1,
    });
    expect(upsert).toHaveBeenCalledOnce();
    const createdInput = upsert.mock.calls[0]?.[0];
    if (!createdInput) throw new Error("Expected roster upsert input");
    expect(createdInput).toMatchObject({
      rosterEntryId,
      expectedRowVersion: 0,
      actor: {
        kind: "user",
        id: "20000000-0000-4000-8000-000000000001",
      },
    });
    expect(createdInput.qualifiedUntil).toBeInstanceOf(Date);

    const updated = await app.request(
      `/v1/system/exception-roster/${rosterEntryId}`,
      {
        method: "PUT",
        headers: headers(true, "exception-roster-update-1"),
        body: JSON.stringify({
          ...rosterBody(1),
          role: "backup",
          absentFrom: "2026-08-02T12:00:00.000Z",
          absentUntil: "2026-08-03T12:00:00.000Z",
        }),
      },
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      role: "backup",
      rowVersion: 2,
      absentFrom: "2026-08-02T12:00:00.000Z",
      absentUntil: "2026-08-03T12:00:00.000Z",
    });

    const caseId = "80000000-0000-4000-8000-000000000001";
    const reassigned = await app.request(
      `/v1/system/exception-cases/${caseId}/reassign`,
      {
        method: "POST",
        headers: headers(true, "exception-case-reassign-1"),
        body: JSON.stringify({
          requestedBy: "20000000-0000-4000-8000-000000000003",
          reason: "Primary operator absence requires qualified reassignment",
        }),
      },
    );
    expect(reassigned.status).toBe(200);
    await expect(reassigned.json()).resolves.toMatchObject({
      id: caseId,
      status: "open",
      ownerUserId: "20000000-0000-4000-8000-000000000004",
      backupUserId: "20000000-0000-4000-8000-000000000005",
      rowVersion: 4,
    });
    expect(reassignOpenCase).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId,
        requestedBy: "20000000-0000-4000-8000-000000000003",
        actor: {
          kind: "user",
          id: "20000000-0000-4000-8000-000000000001",
        },
      }),
    );
  });
});
