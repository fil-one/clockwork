import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OperationsHome } from "./operations-home";

describe("OperationsHome", () => {
  it("separates work requiring action from monitoring signals", () => {
    render(<OperationsHome />);

    const actionSection = screen
      .getByRole("heading", { name: "Work requiring action" })
      .closest("section");
    const monitoringSection = screen
      .getByRole("heading", { name: "Monitoring" })
      .closest("section");

    expect(actionSection).not.toBeNull();
    expect(monitoringSection).not.toBeNull();
    if (!actionSection || !monitoringSection) {
      throw new Error("Expected operational health sections to be rendered.");
    }
    expect(within(actionSection).getByText("Queue breaches")).toBeVisible();
    expect(
      within(actionSection).getByText("Provisioning recovery"),
    ).toBeVisible();
    expect(
      within(monitoringSection).getByText("Reconciliation state"),
    ).toBeVisible();
    expect(
      within(monitoringSection).getByText("Provider blockers"),
    ).toBeVisible();
  });

  it("labels estimates separately from invoice and operational truth", () => {
    render(<OperationsHome />);

    expect(screen.getByText("$1.24M estimated")).toBeVisible();
    expect(screen.getByText("Estimate")).toBeVisible();
    expect(screen.getByText("Invoice truth")).toBeVisible();
    expect(screen.getAllByText("Operational truth").length).toBeGreaterThan(1);
  });
});
