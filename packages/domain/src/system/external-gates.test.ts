import { describe, expect, it } from "vitest";

import {
  assertExternalGateTransition,
  evaluateExternalGate,
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
  lastActivationTestStatus: "passed",
  lastActivationTestAt: "2026-07-31T15:00:00Z",
  lastActivationTestedBy: "platform-owner@filone.test",
  activationEvidenceReference: "evidence://gate/acc/2026-07-31",
  reviewOn: "2026-08-31",
  statusReason: "Staging activation verified",
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
});
