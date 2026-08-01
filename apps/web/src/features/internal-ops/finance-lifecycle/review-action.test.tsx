import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ReviewAction } from "./review-action";

const summary = {
  action: "Stage safe retry",
  entity: "Northstar Archive Labs",
  impact: "A third provider attempt",
  evidence: "Transient timeout with verified idempotency",
  policyBasis: "Provisioning recovery §2.1",
  downstreamEffect: "Activation test before state changes",
  technicalId: "PRV-2026-112 · idem_prv_112_attempt_2",
  actorAuthority: "Server-derived internal operator",
};

describe("safe lifecycle review", () => {
  it("shows the complete review summary and keeps IDs in a disclosure", async () => {
    const user = userEvent.setup();
    render(
      <ReviewAction
        triggerLabel="Review safe retry"
        confirmLabel="Complete review"
        summary={summary}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Review safe retry" }));

    expect(screen.getByText("Northstar Archive Labs")).toBeVisible();
    expect(screen.getByText("Provisioning recovery §2.1")).toBeVisible();
    expect(
      screen.getByText("Activation test before state changes"),
    ).toBeVisible();
    expect(screen.getByText("Technical evidence")).toBeVisible();
    expect(
      screen.queryByText("PRV-2026-112 · idem_prv_112_attempt_2"),
    ).not.toBeVisible();

    await user.click(screen.getByText("Technical evidence"));
    expect(
      screen.getByText("PRV-2026-112 · idem_prv_112_attempt_2"),
    ).toBeVisible();
  });

  it("requires a decision reason before completing review", async () => {
    const user = userEvent.setup();
    render(
      <ReviewAction
        triggerLabel="Review safe retry"
        confirmLabel="Complete review"
        summary={summary}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Review safe retry" }));
    await user.click(screen.getByRole("button", { name: "Complete review" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "A decision reason is required.",
    );
    expect(screen.getByLabelText("Decision reason")).toHaveFocus();

    await user.type(
      screen.getByLabelText("Decision reason"),
      "Verified retry evidence and owner",
    );
    await user.click(screen.getByRole("button", { name: "Complete review" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "no lifecycle state changed here",
    );
  });
});
