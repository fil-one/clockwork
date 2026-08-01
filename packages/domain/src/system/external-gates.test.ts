import { describe, expect, it } from "vitest";

import {
  assertExternalGateTransition,
  evaluateExternalCapabilityAuthorization,
  evaluateExternalGate,
  executeExternalCapabilityBoundary,
  externalCapabilityGateMatrix,
  sanitizeActivationEvidenceReference,
  type ExternalGateRecord,
} from "./external-gates";

const now = new Date("2026-07-31T16:00:00Z");
const valid: ExternalGateRecord = {
  id: "90000000-0000-4000-8000-000000000001",
  gateKey: "EXT-ACC-01",
  title: "Hosted accounts and credentials",
  owner: "Platform owner",
  inputRequired: "Scoped staging and production credentials",
  affectedFeature: "Hosted runtime",
  severity: "path_blocker",
  configuredStatus: "active",
  simulatorState: "ready",
  simulatorDetails: "Provider contract simulator passed",
  inputProvenance: "live_signed",
  lastActivationTestStatus: "passed",
  lastActivationTestAt: "2026-07-31T15:00:00Z",
  lastActivationTestedBy: "platform-owner@filone.test",
  activationEvidenceReference: "evidence://gate/acc/2026-07-31",
  reviewOn: "2026-08-31",
  statusReason: "Staging activation verified",
  emergencyDisabledAt: null,
  emergencyDisabledBy: null,
  emergencyDisableReason: null,
  emergencyDisableEvidenceReference: null,
  rowVersion: 2,
  updatedAt: "2026-07-31T15:00:00Z",
};

describe("external gate activation policy", () => {
  it("allows activation only with current passing evidence", () => {
    expect(evaluateExternalGate(valid, now)).toMatchObject({
      effectiveStatus: "active",
      activationAllowed: true,
      blockedReasons: [],
    });
    expect(() => assertExternalGateTransition(valid, now)).not.toThrow();
  });

  it("fails closed when evidence expires after configuration", () => {
    expect(
      evaluateExternalGate(valid, new Date("2026-09-01T00:00:00Z")),
    ).toMatchObject({
      configuredStatus: "active",
      effectiveStatus: "blocked",
      activationAllowed: false,
      blockedReasons: ["activation_test_expired", "review_missing_or_expired"],
    });
  });

  it("expires activation-test evidence after the fixed freshness window", () => {
    expect(
      evaluateExternalGate(valid, new Date("2026-08-01T15:00:00.001Z")),
    ).toMatchObject({
      effectiveStatus: "blocked",
      activationAllowed: false,
      blockedReasons: ["activation_test_expired"],
    });
  });

  it("sanitizes evidence references and rejects secret-bearing URIs", () => {
    const credentialedEvidenceUri = new URL("https://evidence.fil.one/run/123");
    credentialedEvidenceUri.username = "operator";
    credentialedEvidenceUri.password = ["test", "credential"].join("-");
    expect(
      sanitizeActivationEvidenceReference(
        "https://evidence.fil.one/run/123?signature=secret#fragment",
      ),
    ).toBe("https://evidence.fil.one/run/123");
    expect(() =>
      sanitizeActivationEvidenceReference(credentialedEvidenceUri.toString()),
    ).toThrow(/unsafe/);
  });

  it("denies active and not-required shortcuts", () => {
    expect(() =>
      assertExternalGateTransition(
        {
          ...valid,
          lastActivationTestStatus: "failed",
          activationEvidenceReference: null,
        },
        now,
      ),
    ).toThrow(/cannot activate/);
    expect(() =>
      assertExternalGateTransition(
        {
          ...valid,
          configuredStatus: "not_required",
          statusReason: "",
        },
        now,
      ),
    ).toThrow(/not-required decision/);
  });

  it.each(["EXT-COMMERCIAL-01", "EXT-TAX-01"] as const)(
    "keeps %s blocked when only repository fixtures were exercised",
    (gateKey) => {
      const fixtureOnly = {
        ...valid,
        gateKey,
        inputProvenance: "repository_fixture" as const,
      };
      expect(evaluateExternalGate(fixtureOnly, now)).toMatchObject({
        effectiveStatus: "blocked",
        activationAllowed: false,
        blockedReasons: ["live_signed_input_missing"],
      });
      expect(() => assertExternalGateTransition(fixtureOnly, now)).toThrow(
        /cannot activate/,
      );
    },
  );

  it("fails closed under emergency disable even when all activation evidence is current", () => {
    expect(
      evaluateExternalGate(
        {
          ...valid,
          emergencyDisabledAt: "2026-07-31T15:30:00Z",
          emergencyDisabledBy: "incident-commander",
          emergencyDisableReason: "Provider authorization anomaly",
          emergencyDisableEvidenceReference: "evidence://incident/1234",
        },
        now,
      ),
    ).toMatchObject({
      effectiveStatus: "blocked",
      activationAllowed: false,
      blockedReasons: ["emergency_disabled"],
    });
  });
});

describe("capability-to-gate matrix", () => {
  it("covers every required business capability at every effect boundary", () => {
    expect(Object.keys(externalCapabilityGateMatrix).sort()).toEqual([
      "legal_execution",
      "marketplace",
      "migration",
      "new_business",
      "partner",
      "provisioning_invoicing",
      "teardown",
      "white_label",
    ]);
    const active = evaluateExternalGate(valid, now);
    const gates = new Map(
      externalCapabilityGateMatrix.marketplace.map((gateKey) => [
        gateKey,
        { ...active, gateKey },
      ]),
    );
    gates.set("EXT-MARKETPLACE-01", {
      ...active,
      gateKey: "EXT-MARKETPLACE-01",
      configuredStatus: "blocked",
      effectiveStatus: "blocked",
      activationAllowed: false,
    });
    expect(
      evaluateExternalCapabilityAuthorization({
        capability: "marketplace",
        boundary: "redrive",
        effectIntent: "external_effect",
        gates,
      }),
    ).toMatchObject({
      allowed: false,
      deniedGateKeys: ["EXT-MARKETPLACE-01"],
      permitsOutbox: false,
      permitsProviderEffect: false,
    });
  });

  it("permits independent local recovery without permitting a new effect or outbox", () => {
    expect(
      evaluateExternalCapabilityAuthorization({
        capability: "provisioning_invoicing",
        boundary: "recovery",
        effectIntent: "local_recovery",
        gates: new Map(),
      }),
    ).toEqual({
      capability: "provisioning_invoicing",
      boundary: "recovery",
      effectIntent: "local_recovery",
      allowed: true,
      requiredGateKeys: [],
      deniedGateKeys: [],
      permitsOutbox: false,
      permitsProviderEffect: false,
    });
  });

  it.each([
    "lifecycle",
    "provider_effect",
    "replay",
    "assisted_action",
    "redrive",
    "recovery",
  ] as const)(
    "does not invoke an effect or outbox callback when %s is denied",
    async (boundary) => {
      let effects = 0;
      let outbox = 0;
      await expect(
        executeExternalCapabilityBoundary({
          authorization: {
            capability: "teardown",
            boundary,
            effectIntent: "external_effect",
            allowed: false,
            requiredGateKeys: ["EXT-TEARDOWN-01"],
            deniedGateKeys: ["EXT-TEARDOWN-01"],
            permitsProviderEffect: false,
            permitsOutbox: false,
          },
          performExternalEffect: () => {
            effects += 1;
            return Promise.resolve("forbidden");
          },
          enqueueOutbox: () => {
            outbox += 1;
            return Promise.resolve();
          },
        }),
      ).rejects.toThrow("EXTERNAL_CAPABILITY_DENIED");
      expect({ effects, outbox }).toEqual({ effects: 0, outbox: 0 });
    },
  );
});
