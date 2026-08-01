import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";

vi.mock("server-only", () => ({}));

vi.mock("@/src/features/internal-ops/administration-safety/gates", () => ({
  presentGeneratedGate: (gate: unknown) => gate,
}));

const securitySpies = vi.hoisted(() => ({
  cookieAccess: vi.fn(),
  requestHeadersAccess: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: securitySpies.cookieAccess,
  headers: securitySpies.requestHeadersAccess,
}));

import { loadConfiguredGateRecords } from "./server-gate-loader";

const gate = {
  id: "90000000-0000-4000-8000-000000000001",
  gateKey: "EXT-ACC-01",
  title: "Hosted accounts and credentials",
  owner: "Platform owner",
  inputRequired: "Scoped hosted credentials",
  affectedFeature: "Hosted runtime",
  severity: "path_blocker",
  configuredStatus: "blocked",
  effectiveStatus: "blocked",
  simulatorState: "ready",
  simulatorDetails: "Provider simulator ready",
  inputProvenance: "unverified",
  lastActivationTestStatus: "never",
  lastActivationTestAt: null,
  lastActivationTestedBy: null,
  activationEvidenceReference: null,
  reviewOn: null,
  statusReason: "Production credentials pending",
  activationAllowed: false,
  blockedReasons: ["activation_test_not_passed"],
  rowVersion: 1,
  updatedAt: "2026-07-31T15:00:00Z",
} as const;

describe("external-gate server loader credential containment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    "malformed configured origin",
    "preview deployment origin",
    "hostile lookalike origin",
    "forged x-url header",
  ])("has no outbound-request or cookie-access path for a %s", async () => {
    const outboundFetch = vi.spyOn(globalThis, "fetch");
    const service = { list: vi.fn(() => Promise.resolve([gate])) };

    const result = await loadConfiguredGateRecords(service, {
      requestId: "gate-page:credential-containment",
      now: new Date("2026-07-31T16:00:00.000Z"),
    });

    expect(result.source).toBe("System gate registry");
    expect(service.list).toHaveBeenCalledTimes(1);
    expect(outboundFetch).not.toHaveBeenCalled();
    expect(securitySpies.cookieAccess).not.toHaveBeenCalled();
    expect(securitySpies.requestHeadersAccess).not.toHaveBeenCalled();
    outboundFetch.mockRestore();
  });

  it("fails closed without a database service and still reads no credentials", async () => {
    const outboundFetch = vi.spyOn(globalThis, "fetch");

    const result = await loadConfiguredGateRecords(undefined, {
      runtimeEnvironment: "production",
    });

    expect(result.source).toBe("Fail-closed operational fallback");
    expect(result.gates).toHaveLength(1);
    expect(result.gates[0]?.id).toBe("SYSTEM-GATE-REGISTRY-UNAVAILABLE");
    expect(result.gates[0]?.state).toBe("Blocked");
    expect(result.gates[0]?.reason).toMatch(/could not be read/i);
    expect(outboundFetch).not.toHaveBeenCalled();
    expect(securitySpies.cookieAccess).not.toHaveBeenCalled();
    expect(securitySpies.requestHeadersAccess).not.toHaveBeenCalled();
    outboundFetch.mockRestore();
  });

  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "never shows static gate fixtures when %s marks production",
    async (productionKey) => {
      for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS)
        vi.stubEnv(key, "test");
      vi.stubEnv(productionKey, " Production ");

      const result = await loadConfiguredGateRecords(undefined, {
        runtimeEnvironment: "local",
      });

      expect(result.gates).toHaveLength(1);
      expect(result.gates[0]?.id).toBe("SYSTEM-GATE-REGISTRY-UNAVAILABLE");
    },
  );
});
