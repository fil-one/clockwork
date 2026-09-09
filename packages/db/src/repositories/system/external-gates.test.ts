import { expect, it } from "vitest";

import type { externalGates } from "../../schema/system";
import { mapExternalGateRow } from "./external-gates";

it("projects database rows without leaking storage timestamps into the strict gate response", () => {
  const now = new Date("2026-09-09T00:00:00.000Z");
  const row: typeof externalGates.$inferSelect = {
    id: "939b0c4b-6e18-4386-abeb-5b15b04b8f23",
    gateKey: "EXT-ACC-01",
    title: "Accounting",
    owner: "Finance",
    inputRequired: "Verified provider credentials",
    affectedFeature: "Accounting sync",
    severity: "high",
    configuredStatus: "blocked",
    simulatorState: "ready",
    simulatorDetails: "Simulator available",
    inputProvenance: "unverified",
    lastActivationTestStatus: "never",
    lastActivationTestAt: null,
    lastActivationTestedBy: null,
    activationEvidenceReference: null,
    reviewOn: null,
    statusReason: "Awaiting provider verification",
    emergencyDisabledAt: null,
    emergencyDisabledBy: null,
    emergencyDisableReason: null,
    emergencyDisableEvidenceReference: null,
    rowVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
  const mapped = mapExternalGateRow(row);
  expect(mapped).not.toHaveProperty("createdAt");
  expect(mapped.updatedAt).toBe(now.toISOString());
  expect(mapped).toMatchObject({
    gateKey: row.gateKey,
    configuredStatus: "blocked",
    inputProvenance: "unverified",
  });
});
