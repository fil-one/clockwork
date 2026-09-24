import { render, screen, within } from "@testing-library/react";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/features/internal-ops/gates/demo-gate-actions", () => ({
  updateDemoExternalGate: vi.fn(),
  runDemoExternalGateActivationTest: vi.fn(),
}));

import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";

import { demoGateText, fallbackGateFreshness, fallbackGates } from "./data";
import { GateRegister, presentGeneratedGate } from "./gates";
import { styles } from "./ui";

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
    inputProvenance: "unverified",
    lastActivationTestStatus: "never",
    lastActivationTestAt: null,
    lastActivationTestedBy: null,
    activationEvidenceReference: null,
    reviewOn: null,
    statusReason: "Production evidence is pending",
    emergencyDisabledAt: null,
    emergencyDisabledBy: null,
    emergencyDisableReason: null,
    emergencyDisableEvidenceReference: null,
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

  it("labels every fallback row as not read instead of fabricating freshness", () => {
    expect(fallbackGates.map((gate) => gate.freshness)).toEqual(
      Array.from({ length: fallbackGates.length }, () => fallbackGateFreshness),
    );
    expect(
      fallbackGates
        .flatMap((gate) => [gate.freshness, gate.activationTest])
        .join(" "),
    ).not.toMatch(
      /(?:updated|reviewed|tested) (?:today|yesterday|\d+ (?:minutes?|hours?) ago)|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i,
    );
  });

  it("never presents configured active as effective active without eligibility", () => {
    const gate = presentGeneratedGate(
      {
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
        inputProvenance: "live_signed",
        lastActivationTestStatus: "passed",
        lastActivationTestAt: "2026-07-31T15:00:00Z",
        lastActivationTestedBy: "operator",
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
    const row = screen.getByRole("row", {
      name: /Counsel-approved legal policy/,
    });
    expect(within(row).getByText("Configured: Active")).toBeVisible();
    expect(
      within(row).getByText("Blocked", { selector: "span" }),
    ).toBeVisible();
    expect(within(row).getByText("Effective: Blocked")).toBeVisible();
    expect(within(row).getByText("Activation denied")).toBeVisible();
    expect(within(row).getByText("Blockers: Evidence missing")).toBeVisible();
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
    // The loader's stand-in row is product text, worded by the register.
    expect(
      screen.getByText("External-gate registry unavailable"),
    ).toBeVisible();
    expect(screen.getByText("Activation denied")).toBeVisible();
  });

  it("groups legal, domain, and brand truth and exposes persisted controls", () => {
    const records = [
      presentGeneratedGate(generated("EXT-LEGAL-01"), "en-US"),
      presentGeneratedGate(generated("EXT-DOMAIN-01"), "en-US"),
      presentGeneratedGate(generated("EXT-BRAND-01"), "en-US"),
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

  /**
   * Every severity chip used to be amber, so a launch blocker looked no more
   * urgent than a medium risk. The colour now follows the severity itself.
   */
  it("colours a launch blocker as danger and a path blocker as a warning", () => {
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[
          presentGeneratedGate(generated("EXT-LEGAL-01"), "en-US"),
          presentGeneratedGate(
            generated("EXT-DOMAIN-01", { severity: "path_blocker" }),
            "en-US",
          ),
        ]}
        source="System gate registry"
      />,
    );
    const table = (name: string) =>
      within(screen.getByRole("region", { name })).getByRole("table");
    expect(within(table("Legal")).getByText("Launch blocker")).toHaveClass(
      styles.danger ?? "",
    );
    expect(within(table("Brand")).getByText("Path blocker")).toHaveClass(
      styles.warning ?? "",
    );
  });

  it("exposes the same persisted controls for the demonstration registry", () => {
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[presentGeneratedGate(generated("EXT-PROVIDER-01"), "en-US")]}
        source="Demonstration gate registry"
      />,
    );
    expect(screen.getByText("Update or test gate")).toBeVisible();
    expect(screen.getByText("Demonstration gate registry")).toBeVisible();
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
      "en-US",
    );
    render(
      <GateRegister
        roles={["internal_operator"]}
        gates={[record]}
        source="System gate registry"
      />,
    );
    const row = screen.getByRole("row", { name: /EXT-DOMAIN-01 gate/ });
    expect(within(row).getByText("Configured: Active")).toBeVisible();
    expect(within(row).getByText("Effective: Blocked")).toBeVisible();
    expect(within(row).getByText("Activation denied")).toBeVisible();
  });
});

describe("the gate register in the reader's language", () => {
  const seed = fallbackGates.find((gate) => gate.id === "EXT-ACC-01");
  if (!seed) throw new Error("fixture EXT-ACC-01 is missing");
  const demoRow = (overrides: Partial<GeneratedExternalGate> = {}) =>
    presentGeneratedGate(
      {
        id: "90000000-0000-4000-8000-000000000009",
        gateKey: "EXT-ACC-01",
        title: seed.title,
        owner: seed.owner,
        inputRequired: seed.reason,
        affectedFeature: seed.capability,
        severity: "launch_blocker",
        configuredStatus: "pending",
        effectiveStatus: "pending",
        simulatorState: "ready",
        simulatorDetails: seed.activationTest,
        inputProvenance: "repository_fixture",
        lastActivationTestStatus: "passed",
        lastActivationTestAt: "2026-07-31T15:00:00Z",
        lastActivationTestedBy: "operator",
        activationEvidenceReference: null,
        reviewOn: null,
        statusReason: seed.reason,
        emergencyDisabledAt: null,
        emergencyDisabledBy: null,
        emergencyDisableReason: null,
        emergencyDisableEvidenceReference: null,
        activationAllowed: false,
        blockedReasons: ["review_missing_or_expired"],
        rowVersion: 2,
        updatedAt: "2026-07-31T15:01:00Z",
        ...overrides,
      },
      "pt-BR",
    );
  const inPortuguese = (ui: React.ReactNode) =>
    render(
      <LanguageProvider locale="pt" catalog={catalogs.pt}>
        {ui}
      </LanguageProvider>,
    );

  it("words demo fixture text, statuses and blocker codes in Portuguese", () => {
    inPortuguese(
      <GateRegister
        roles={["internal_operator"]}
        gates={[demoRow()]}
        source="Demonstration gate registry"
        demoText={demoGateText("pt")}
      />,
    );
    expect(
      screen.getByText("Registro de pré-requisitos de demonstração"),
    ).toBeVisible();
    const row = screen.getByRole("row", {
      name: /Contas hospedadas e credenciais/,
    });
    expect(within(row).getByText("Responsável pela plataforma")).toBeVisible();
    expect(
      within(row).getByText("Testes de credenciais hospedadas não executados"),
    ).toBeVisible();
    expect(within(row).getByText(/^Aprovado · /)).toBeVisible();
    expect(
      within(row).getByText("Bloqueios: data de revisão ausente ou vencida"),
    ).toBeVisible();
    expect(within(row).getByText("Ativação negada")).toBeVisible();
    expect(
      within(row).getByText("Atualizar ou testar o pré-requisito"),
    ).toBeInTheDocument();
  });

  it("shows what an operator typed over a demo field as written", () => {
    inPortuguese(
      <GateRegister
        roles={["internal_operator"]}
        gates={[demoRow({ owner: "Northwind platform desk" })]}
        source="Demonstration gate registry"
        demoText={demoGateText("pt")}
      />,
    );
    const row = screen.getByRole("row", {
      name: /Contas hospedadas e credenciais/,
    });
    expect(within(row).getByText("Northwind platform desk")).toBeVisible();
  });

  it("leaves system registry rows as the registry wrote them", () => {
    inPortuguese(
      <GateRegister
        roles={["internal_operator"]}
        gates={[demoRow()]}
        source="System gate registry"
      />,
    );
    expect(
      screen.getByRole("row", { name: /Hosted accounts and credentials/ }),
    ).toBeVisible();
    expect(
      screen.getByText("Registro de pré-requisitos do sistema"),
    ).toBeVisible();
  });

  it("words the fallback fixtures, including their freshness, in Japanese", () => {
    render(
      <LanguageProvider locale="ja" catalog={catalogs.ja}>
        <GateRegister
          roles={["internal_operator"]}
          gates={fallbackGates}
          source="Fail-closed operational fallback"
          demoText={demoGateText("ja")}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText("ホスト環境のアカウントと認証情報")).toBeVisible();
    expect(
      screen.getAllByText(
        "フォールバックのレコード：ゲートレジストリからは読み込んでいません",
      ),
    ).toHaveLength(fallbackGates.length);
    expect(screen.queryByText(fallbackGateFreshness)).not.toBeInTheDocument();
  });
});
