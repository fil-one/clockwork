import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";

import { fallbackGates } from "./data";
import { GateRegister, presentGeneratedGate } from "./gates";

describe("truthful external-gate administration", () => {
  const generated = (
    gateKey: GeneratedExternalGate["gateKey"],
    overrides: Partial<GeneratedExternalGate> = {},
  ): GeneratedExternalGate => ({
    id: `90000000-0000-4000-8000-${gateKey.endsWith("LEGAL-01") ? "000000000001" : gateKey.endsWith("DOMAIN-01") ? "000000000002" : "000000000003"}`,
    gateKey,
    title: `${gateKey} gate`,
    owner: "Named owner",
    inputRequired: "Dated production evidence",
    affectedFeature: "Externally gated capability",
    severity: "launch_blocker",
    configuredStatus: "review",
    effectiveStatus: "blocked",
    simulatorState: "ready",
    simulatorDetails: "Activation runner ready",
    lastActivationTestStatus: "never",
    lastActivationTestAt: null,
    lastActivationTestedBy: null,
    activationEvidenceReference: null,
    reviewOn: null,
    statusReason: "Production evidence is pending",
    activationAllowed: false,
    blockedReasons: ["activation_test_not_passed"],
    rowVersion: 1,
    updatedAt: "2026-07-31T15:01:00Z",
    ...overrides,
  });

  it("keeps all twelve gate paths visible in the explicit demo registry", () => {
    expect(fallbackGates).toHaveLength(12);
    expect(new Set(fallbackGates.map((gate) => gate.id)).size).toBe(12);
  });

  it("never presents configured active as effective active without eligibility", () => {
    const gate = presentGeneratedGate({
      id: "90000000-0000-4000-8000-000000000001",
      gateKey: "EXT-LEGAL-01",
      title: "Counsel-approved legal policy",
      owner: "General counsel",
      inputRequired: "Approved hashes",
      affectedFeature: "Agreement publication",
      severity: "launch_blocker",
      configuredStatus: "active",
      effectiveStatus: "blocked",
      simulatorState: "ready",
      simulatorDetails: "Hash simulator ready",
      lastActivationTestStatus: "passed",
      lastActivationTestAt: "2026-07-31T15:00:00Z",
      lastActivationTestedBy: "operator",
      activationEvidenceReference: null,
      reviewOn: null,
      statusReason: "Evidence missing",
      activationAllowed: false,
      blockedReasons: ["evidence_missing"],
      rowVersion: 4,
      updatedAt: "2026-07-31T15:01:00Z",
    } satisfies GeneratedExternalGate);

    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[gate]}
        source="System gate registry"
      />,
    );
    const row = screen.getByRole("row", {
      name: /Counsel-approved legal policy/,
    });
    expect(within(row).getByText("Configured: active")).toBeVisible();
    expect(
      within(row).getByText("Blocked", { selector: "span" }),
    ).toBeVisible();
    expect(within(row).getByText("Effective: blocked")).toBeVisible();
    expect(within(row).getByText("Activation denied")).toBeVisible();
    expect(within(row).getByText(/evidence_missing/)).toBeVisible();
  });

  it("renders registry failure as activation denied", () => {
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[
          {
            id: "SYSTEM-GATE-REGISTRY-UNAVAILABLE",
            group: "Operations",
            title: "Gate registry unavailable",
            owner: "Platform operations",
            capability: "Every externally gated capability",
            activationTest: "Not available",
            severity: "Launch blocker",
            state: "Blocked",
            freshness: "Unavailable",
            reason: "Persistent status could not be loaded.",
            activationAllowed: false,
            blockedReasons: ["registry_unavailable"],
          },
        ]}
        source="Fail-closed operational fallback"
      />,
    );
    expect(screen.getByText("Gate registry unavailable")).toBeVisible();
    expect(screen.getByText("Activation denied")).toBeVisible();
  });

  it("groups legal, domain, and brand truth and exposes persisted controls", () => {
    const records = [
      presentGeneratedGate(generated("EXT-LEGAL-01")),
      presentGeneratedGate(generated("EXT-DOMAIN-01")),
      presentGeneratedGate(generated("EXT-BRAND-01")),
    ];
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={records}
        source="System gate registry"
      />,
    );
    const legal = screen.getByRole("region", { name: "Legal" });
    expect(within(legal).getByText("EXT-LEGAL-01 gate")).toBeVisible();
    const brand = screen.getByRole("region", { name: "Brand" });
    expect(within(brand).getByText("EXT-DOMAIN-01 gate")).toBeVisible();
    expect(within(brand).getByText("EXT-BRAND-01 gate")).toBeVisible();
    expect(screen.getAllByText("Update or test gate")).toHaveLength(3);
  });

  it("keeps configured active blocked when no activation test exists", () => {
    const record = presentGeneratedGate(
      generated("EXT-DOMAIN-01", {
        configuredStatus: "active",
        effectiveStatus: "blocked",
        lastActivationTestStatus: "never",
        activationAllowed: false,
        blockedReasons: ["activation_test_not_passed"],
      }),
    );
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[record]}
        source="System gate registry"
      />,
    );
    const row = screen.getByRole("row", { name: /EXT-DOMAIN-01 gate/ });
    expect(within(row).getByText("Configured: active")).toBeVisible();
    expect(within(row).getByText("Effective: blocked")).toBeVisible();
    expect(within(row).getByText("Activation denied")).toBeVisible();
  });
});
