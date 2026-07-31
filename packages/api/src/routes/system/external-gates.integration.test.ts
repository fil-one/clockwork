import { describe, expect, it } from "vitest";

import {
  EXTERNAL_GATE_ACTIVATION_TEST_MAX_AGE_MS,
  type ActivationTestRunner,
  type ExternalGateRecord,
} from "@clockwork/domain/system";

import { createApiApp } from "../../app";
import {
  ExternalGateViewSchema,
  MemoryExternalGateService,
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
  lastActivationTestStatus: "never",
  lastActivationTestAt: null,
  lastActivationTestedBy: null,
  activationEvidenceReference: null,
  reviewOn: null,
  statusReason: "Production credentials pending",
  rowVersion: 1,
  updatedAt: "2026-07-31T15:00:00Z",
};

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
      }),
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
});
