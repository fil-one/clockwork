import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkflowPanel } from "./workflow-panel";

describe("keyboard-first commerce workflows", () => {
  it("validates the quote locally and restores focus to the invalid field", async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel workflow="quote" />);
    const capacity = screen.getByLabelText("Committed capacity");
    await user.clear(capacity);
    await user.type(capacity, "4");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 10 TB");
    expect(capacity).toHaveFocus();
  });

  it("announces successful optimistic completion", async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel workflow="account" />);
    await user.type(
      screen.getByLabelText("Reason for assisted action"),
      "Annual AP refresh",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText("Changes saved", {}, { timeout: 1500 }),
    ).toHaveAttribute("role", "status");
  });

  it("rolls an optimistic quote back when the fixture reports a stale version", async () => {
    const user = userEvent.setup();
    render(<WorkflowPanel workflow="quote" />);
    const capacity = screen.getByRole("textbox", {
      name: "Committed capacity",
    });
    await user.clear(capacity);
    await user.type(capacity, "13");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByRole("alert", {}, { timeout: 1500 }),
    ).toHaveTextContent("latest version");
    expect(capacity).toHaveValue("120");
    expect(capacity).toHaveFocus();
  });
});
