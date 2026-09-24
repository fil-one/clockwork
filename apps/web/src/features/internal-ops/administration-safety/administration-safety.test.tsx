import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/auth/actions", () => ({ startAssistedSession: vi.fn() }));

import { resolveDemoText } from "@clockwork/testing/demo-localized-text";

import { catalogs } from "@/src/i18n/catalogs";
import { LanguageProvider } from "@/src/i18n/client";

import { AgreementAdministration } from "./agreements";

import { ApprovalWorkspace } from "./approvals";
import { AssistedMode } from "./assisted";
import { accounts, agreementScanAt, agreementVersions } from "./data";
import {
  assistedCommercialActionReady,
  buildReviewSummary,
  canDecide,
  disclosedIdentifiers,
} from "./policy";
import { HumanSelector, StatusPill, TechnicalEvidence, styles } from "./ui";

describe("administration and safety policy", () => {
  it("keeps finance, legal, destructive, and assisted authorities segregated", () => {
    expect(canDecide(["finance_approver"], "finance")).toBe(true);
    expect(canDecide(["finance_approver"], "legal")).toBe(false);
    expect(canDecide(["legal_approver"], "legal")).toBe(true);
    expect(canDecide(["legal_approver"], "destructive")).toBe(false);
    expect(canDecide(["destructive_action_approver"], "destructive")).toBe(
      true,
    );
    expect(canDecide(["internal_operator"], "assisted")).toBe(true);
  });

  it("requires a reason and complete decision summary evidence", () => {
    const input = {
      entity: "Legacy analytics archive",
      impact: "Approves unlocked-object deletion.",
      evidence: ["Retention scan complete"],
      policyBasis: "Retention policy RT-9",
      downstreamEffect: "Second distinct approval remains required.",
      reason: "  Evidence supports the controlled path.  ",
    } as const;
    expect(buildReviewSummary(input)).toEqual({
      ...input,
      reason: "Evidence supports the controlled path.",
    });
    expect(() => buildReviewSummary({ ...input, reason: "short" })).toThrow(
      /specific decision reason/i,
    );
    expect(() => buildReviewSummary({ ...input, evidence: [] })).toThrow(
      /evidence item/i,
    );
  });

  it("does not enable an assisted commercial action before review", () => {
    const base = {
      roles: ["internal_operator"],
      reason: "Customer requested staff assistance",
      effectiveAccountId: "account-1",
    } as const;
    expect(assistedCommercialActionReady({ ...base, reviewed: false })).toBe(
      false,
    );
    expect(assistedCommercialActionReady({ ...base, reviewed: true })).toBe(
      true,
    );
    expect(
      assistedCommercialActionReady({
        ...base,
        roles: ["finance_approver"],
        reviewed: true,
      }),
    ).toBe(false);
  });
});

describe("administration and safety disclosure UI", () => {
  it("keeps the submitted account ID behind a human-readable selector", () => {
    const options = resolveDemoText(accounts, "en");
    const { container } = render(
      <HumanSelector
        label="Effective account"
        name="effectiveAccountId"
        options={options}
        value={options[0]?.id ?? ""}
        onChange={() => undefined}
      />,
    );
    const selector = screen.getByRole<HTMLInputElement>("combobox", {
      name: "Effective account",
    });
    expect(selector.value).toContain("Northstar Archive Labs");
    expect(
      container.querySelector('input[name="effectiveAccountId"]'),
    ).toHaveValue(accounts[0]?.id);
    expect(selector.value).not.toContain(accounts[0]?.id ?? "");
  });

  it("filters blank identifiers and discloses technical evidence on demand", async () => {
    const identifiers = disclosedIdentifiers([
      { label: "Agreement ID", value: "99999999-9999-4999-8999-999999999999" },
      { label: "Empty", value: "" },
    ]);
    expect(identifiers).toHaveLength(1);
    render(<TechnicalEvidence identifiers={identifiers} />);
    const technicalId = screen.getByText(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(technicalId).not.toBeVisible();
    await userEvent.click(
      screen.getByText("Technical evidence", { selector: "summary" }),
    );
    expect(technicalId).toBeVisible();
  });

  it("disables a finance decision for legal authority while retaining review access", () => {
    const { rerender } = render(
      <ApprovalWorkspace roles={["legal_approver"]} />,
    );
    expect(
      screen.getByRole("button", { name: "Review approval" }),
    ).toBeDisabled();
    expect(
      screen.getByText("This role cannot decide this case."),
    ).toBeVisible();
    rerender(<ApprovalWorkspace roles={["finance_approver"]} />);
    expect(
      screen.getByRole("button", { name: "Review approval" }),
    ).toBeEnabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Decision reason/ }), {
      target: { value: "Margin evidence supports the exception." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review approval" }));
    expect(
      screen.getByRole("heading", { name: "Approval review summary" }),
    ).toBeVisible();
  });
});

describe("agreement version filters", () => {
  it("filters by state and jurisdiction when the labels are translated", async () => {
    const { container } = render(
      <LanguageProvider locale="pt" catalog={catalogs.pt}>
        <AgreementAdministration
          roles={["legal_approver"]}
          versions={resolveDemoText(agreementVersions, "pt")}
          scannedAt={agreementScanAt}
          readOnly
        />
      </LanguageProvider>,
    );
    const rows = () =>
      within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const selects = container.querySelectorAll("select");
    const jurisdiction = selects[0] as HTMLSelectElement;
    const state = selects[1] as HTMLSelectElement;
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toHaveTextContent("Acordo de serviços em nuvem");

    await userEvent.selectOptions(state, "Rascunho");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("3.3.0");

    await userEvent.selectOptions(state, "Todos");
    await userEvent.selectOptions(jurisdiction, "Reino Unido");
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("1.4.0");
  });
});

describe("status chip colour", () => {
  it("comes from the caller's tone, never from English words in the label", () => {
    render(
      <>
        <StatusPill state="Active" />
        <StatusPill state="Blocked" />
        <StatusPill state="Vigente" tone="success" />
        <StatusPill state="Bloqueado" tone="danger" />
      </>,
    );
    // A label alone is neutral, even when it is an English status word.
    expect(screen.getByText("Active")).toHaveClass(styles.pill ?? "");
    expect(screen.getByText("Active")).not.toHaveClass(styles.success ?? "");
    expect(screen.getByText("Blocked")).not.toHaveClass(styles.danger ?? "");
    expect(screen.getByText("Vigente")).toHaveClass(styles.success ?? "");
    expect(screen.getByText("Bloqueado")).toHaveClass(styles.danger ?? "");
  });

  /**
   * These chips were all amber whatever they said, so "Up to date" and an
   * authority the reader holds looked like warnings.
   */
  it("colours a current registry and a held authority as success", () => {
    const { unmount } = render(
      <AgreementAdministration
        roles={["legal_approver"]}
        versions={resolveDemoText(agreementVersions, "en")}
        scannedAt={agreementScanAt}
        readOnly
      />,
    );
    expect(screen.getByText("Up to date")).toHaveClass(styles.success ?? "");
    expect(screen.getByText("Legal authority")).toHaveClass(
      styles.success ?? "",
    );
    unmount();
    const { rerender } = render(
      <ApprovalWorkspace roles={["finance_approver"]} />,
    );
    expect(screen.getByText("Authorized role")).toHaveClass(
      styles.success ?? "",
    );
    rerender(<ApprovalWorkspace roles={["legal_approver"]} />);
    expect(screen.getByText("Read only")).toHaveClass(styles.warning ?? "");
    rerender(
      <AssistedMode
        roles={["internal_operator"]}
        accounts={resolveDemoText(accounts, "en")}
        actor="Ada Mercer"
      />,
    );
    expect(screen.getByText("Can act for accounts")).toHaveClass(
      styles.success ?? "",
    );
  });

  it("colours translated agreement states from the state itself", () => {
    render(
      <LanguageProvider locale="pt" catalog={catalogs.pt}>
        <AgreementAdministration
          roles={["legal_approver"]}
          versions={resolveDemoText(agreementVersions, "pt")}
          scannedAt={agreementScanAt}
          readOnly
        />
      </LanguageProvider>,
    );
    const table = screen.getByRole("table");
    for (const chip of within(table).getAllByText("Vigente"))
      expect(chip).toHaveClass(styles.success ?? "");
    expect(within(table).getByText("Aprovada")).toHaveClass(
      styles.success ?? "",
    );
    expect(within(table).getByText("Rascunho")).toHaveClass(
      styles.warning ?? "",
    );
  });
});
