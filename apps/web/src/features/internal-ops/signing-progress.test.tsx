import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SigningProgress, signingProgress } from "./signing-progress";

describe("confirmed signing progress", () => {
  it("distinguishes preparation, sending and the current counterparty signature", () => {
    expect(signingProgress({ state: "draft", prepared: true })).toEqual([
      { id: "prepared", status: "done" },
      { id: "sent", status: "current" },
      { id: "counterparty", status: "pending" },
      { id: "countersigned", status: "pending" },
      { id: "saved", status: "pending" },
    ]);
    expect(signingProgress({ state: "viewed", prepared: true })).toContainEqual(
      { id: "counterparty", status: "current" },
    );
  });

  it("keeps Fil One signature and final PDF pending after the partner signs", () => {
    expect(
      signingProgress({ state: "awaiting_countersignature", prepared: true }),
    ).toEqual([
      { id: "prepared", status: "done" },
      { id: "sent", status: "done" },
      { id: "counterparty", status: "done" },
      { id: "countersigned", status: "current" },
      { id: "saved", status: "pending" },
    ]);
  });

  it("does not invent historical signatures or current work for a held or closed request", () => {
    for (const state of [
      "attention",
      "canceled",
      "declined",
      "expired",
    ] as const) {
      const progress = signingProgress({ state, prepared: true, sent: true });
      expect(progress.find((step) => step.id === "sent")?.status).toBe("done");
      expect(
        progress
          .filter((step) =>
            ["counterparty", "countersigned", "saved"].includes(step.id),
          )
          .every((step) => step.status === "unconfirmed"),
      ).toBe(true);
      expect(progress.some((step) => step.status === "current")).toBe(false);
    }
    expect(
      signingProgress({ state: "attention", prepared: true }).find(
        (step) => step.id === "sent",
      )?.status,
    ).toBe("unconfirmed");
  });

  it("adapts approval and signatures to uploaded PDFs with only a Fil One signer", () => {
    const pending = signingProgress({
      state: "draft",
      prepared: true,
      counterpartySigns: false,
      approval: "pending",
    });
    expect(pending.find((step) => step.id === "approved")?.status).toBe(
      "current",
    );
    expect(pending.some((step) => step.id === "counterparty")).toBe(false);
    const sent = signingProgress({
      state: "sent",
      prepared: true,
      counterpartySigns: false,
      approval: "approved",
    });
    expect(sent.find((step) => step.id === "countersigned")?.status).toBe(
      "current",
    );
    expect(
      signingProgress({
        state: "completed",
        prepared: true,
        counterpartySigns: false,
      }).every((step) => step.status === "done"),
    ).toBe(true);
  });

  it("marks a rejected approval explicitly and pauses subsequent progress", () => {
    const steps = signingProgress({
      state: "draft",
      prepared: true,
      approval: "rejected",
    });
    expect(steps.find((step) => step.id === "approved")?.status).toBe(
      "rejected",
    );
    expect(steps.find((step) => step.id === "sent")?.status).toBe(
      "unconfirmed",
    );
    expect(steps.some((step) => step.status === "current")).toBe(false);
  });

  it("starts collapsed, names the document and exposes readable statuses without relying on color", () => {
    render(
      <SigningProgress
        subject="Example Co"
        state="awaiting_countersignature"
        prepared
      />,
    );
    const disclosure = screen.getByText("View progress");
    expect(disclosure).toHaveAccessibleName(
      "View signing progress for Example Co",
    );
    const details = disclosure.closest("details");
    expect(details).not.toHaveAttribute("open");
    details?.setAttribute("open", "");
    const list = screen.getByRole("list", {
      name: "Last confirmed signing progress",
    });
    const current = within(list).getByText("Fil One signed").closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
    if (!current) throw new Error("Missing current progress step");
    expect(within(current).getByText("Current step")).toBeVisible();
    expect(
      within(list).getByText("Final PDF saved").closest("li"),
    ).toHaveTextContent("Pending");
  });
});
