import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/src/features/internal-ops/gates/demo-gate-actions", () => ({
  updateDemoExternalGate: vi.fn(),
  runDemoExternalGateActivationTest: vi.fn(),
}));

import { canonicalDemoPriceBooks } from "../price-books/demo-price-books";
import { demoPriceBookImpact } from "../price-books/server-price-book-impact-loader";
import { GateRegister, presentGeneratedGate } from "./gates";
import { PriceBookImpactPanel } from "./price-book-impact";
import { PriceBookAdministration } from "./price-books";

/**
 * The unit-test harness pins TZ to UTC. These render each staff timestamp
 * this lane moved off forced UTC with a reader in New York, so a regression
 * back to UTC (or to a fixed desk zone) fails here.
 */
beforeEach(() => {
  process.env.TZ = "America/New_York";
});
afterEach(() => {
  process.env.TZ = "UTC";
});

describe("staff timestamps in the reader's zone", () => {
  it("states a gate's update time in the reader's zone", () => {
    const gate = presentGeneratedGate(
      {
        id: "90000000-0000-4000-8000-000000000001",
        gateKey: "EXT-LEGAL-01",
        title: "Counsel-approved legal policy",
        owner: "General counsel",
        inputRequired: "Approved hashes",
        affectedFeature: "Agreement publication",
        severity: "launch_blocker",
        configuredStatus: "review",
        effectiveStatus: "review",
        simulatorState: "ready",
        simulatorDetails: "Hash simulator ready",
        inputProvenance: "live_signed",
        lastActivationTestStatus: "never",
        lastActivationTestAt: null,
        lastActivationTestedBy: null,
        activationEvidenceReference: null,
        reviewOn: null,
        statusReason: "Evidence missing",
        emergencyDisabledAt: null,
        emergencyDisabledBy: null,
        emergencyDisableReason: null,
        emergencyDisableEvidenceReference: null,
        activationAllowed: false,
        blockedReasons: ["evidence_missing"],
        rowVersion: 4,
        updatedAt: "2026-07-31T15:01:00Z",
      } satisfies GeneratedExternalGate,
      "en-US",
    );
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[gate]}
        source="System gate registry"
      />,
    );
    expect(screen.getByText(/Jul 31, 2026, 11:01 AM EDT/)).toBeVisible();
    expect(screen.queryByText(/3:01 PM UTC/)).toBeNull();
  });

  it("states the price-book read time in the reader's zone", () => {
    render(
      <PriceBookAdministration
        roles={["finance_approver"]}
        userId="21000000-0000-4000-8000-000000000008"
        books={[]}
        source="service"
        availability="empty"
        readAt="2026-08-18T12:00:00.000Z"
      />,
    );
    expect(screen.getByText(/Aug 18, 2026, 8:00 AM EDT/)).toBeVisible();
  });

  it("states when price-book impact was checked in the reader's zone", () => {
    const [incumbent, , candidate] = canonicalDemoPriceBooks;
    if (!incumbent || !candidate) throw new Error("fixtures are missing");
    render(
      <PriceBookImpactPanel
        candidate={candidate}
        incumbent={incumbent}
        impact={demoPriceBookImpact(
          canonicalDemoPriceBooks,
          "2026-09-06T12:00:00.000Z",
        )}
      />,
    );
    expect(screen.getByText(/Sep 6, 2026, 8:00 AM EDT/)).toBeVisible();
  });
});
