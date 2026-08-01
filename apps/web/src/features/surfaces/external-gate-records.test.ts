import { describe, expect, it } from "vitest";

import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";

import {
  externalGateFallback,
  externalGateRecords,
} from "./external-gate-records";

describe("external gate presentation", () => {
  it("shows fail-closed activation evidence and blocked reasons", () => {
    const record = externalGateRecords([
      {
        id: "90000000-0000-4000-8000-000000000001",
        gateKey: "EXT-ACC-01",
        title: "Hosted accounts and credentials",
        owner: "Platform owner",
        inputRequired: "Scoped hosted credentials",
        affectedFeature: "Hosted runtime",
        severity: "path_blocker",
        configuredStatus: "active",
        effectiveStatus: "blocked",
        simulatorState: "ready",
        simulatorDetails: "Provider simulator ready",
        inputProvenance: "live_signed",
        lastActivationTestStatus: "passed",
        lastActivationTestAt: "2026-07-01T00:00:00Z",
        lastActivationTestedBy: "platform-owner@filone.test",
        activationEvidenceReference: "evidence://expired",
        reviewOn: "2026-07-30",
        statusReason: "Evidence review expired",
        emergencyDisabledAt: null,
        emergencyDisabledBy: null,
        emergencyDisableReason: null,
        emergencyDisableEvidenceReference: null,
        activationAllowed: false,
        blockedReasons: ["review_missing_or_expired"],
        rowVersion: 2,
        updatedAt: "2026-07-31T15:00:00Z",
      } satisfies GeneratedExternalGate,
    ])[0];
    expect(record).toMatchObject({
      id: "EXT-ACC-01",
      status: "status.blocked",
      tone: "danger",
      risk: "high",
      value: "Blocked: review_missing_or_expired",
    });
    expect(record?.meta).toContain("Activation test: passed");
    expect(record?.meta).toContain("Evidence: evidence://expired");
    expect(record?.meta).toContain("Review: 2026-07-30");
  });

  it("uses demo data only in explicit demo runtimes and fails closed otherwise", () => {
    expect(externalGateFallback("development")).toHaveLength(12);
    expect(externalGateFallback("test")).toHaveLength(12);
    for (const runtime of [undefined, "staging", "production"]) {
      expect(externalGateFallback(runtime)).toEqual([
        expect.objectContaining({
          id: "GATE-REGISTRY-UNAVAILABLE",
          status: "status.blocked",
          tone: "danger",
          risk: "high",
        }),
      ]);
    }
  });
});
