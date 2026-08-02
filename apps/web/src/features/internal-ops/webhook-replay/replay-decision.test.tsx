import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replay = vi.hoisted(() => vi.fn());

vi.mock("./actions", () => ({ replayWebhookEvent: replay }));

import { ReplayDecision } from "./replay-decision";

const REASON = "INC-4021 duplicate delivery, safe to replay";

function open() {
  return render(
    <ReplayDecision
      provider="stripe"
      providerEventId="evt_1J4k"
      eventType="invoice.payment_failed"
      payloadHash="sha256:9f2c"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  replay.mockResolvedValue({
    ok: true,
    started: true,
    workflowRunId: "60000000-0000-4000-8000-000000000001",
  });
});

describe("replay decision", () => {
  it("states that replay re-processes the stored verified event", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Replay" }));

    // An operator who expects a corrected payload to be picked up would replay
    // the same broken event repeatedly. The dialog has to say it cannot.
    const effect = screen.getByText(/bytes verified at delivery/i);
    expect(effect).toBeVisible();
    expect(effect).toHaveTextContent(/corrected payload cannot be picked up/i);
    expect(screen.getByText("sha256:9f2c")).toBeVisible();
  });

  it("blocks a reason shorter than the audit minimum", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Replay" }));
    await user.type(screen.getByLabelText("Reason"), "INC-402");
    await user.click(
      screen.getByRole("button", { name: "Replay this callback" }),
    );

    expect(
      screen.getByText("Give a reason of at least 8 characters."),
    ).toBeVisible();
    expect(replay).not.toHaveBeenCalled();
  });

  it("reports a replay that is already running instead of a second success", async () => {
    replay.mockResolvedValue({
      ok: true,
      started: false,
      code: "WEBHOOK_REPLAY_ALREADY_RUNNING",
    });
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Replay" }));
    await user.type(screen.getByLabelText("Reason"), REASON);
    await user.click(
      screen.getByRole("button", { name: "Replay this callback" }),
    );

    expect(
      await screen.findByText(
        "A replay for this callback is already running. Nothing new was started.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Replay started.")).not.toBeInTheDocument();
  });

  it("names an event id with no verified row", async () => {
    replay.mockResolvedValue({
      ok: false,
      code: "WEBHOOK_REPLAY_EVENT_NOT_FOUND",
    });
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Replay" }));
    await user.type(screen.getByLabelText("Reason"), REASON);
    await user.click(
      screen.getByRole("button", { name: "Replay this callback" }),
    );

    expect(
      await screen.findByText(
        "No verified callback matches this provider and event id.",
      ),
    ).toBeVisible();
  });

  it("confirms a started replay and sends the operator reason", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: "Replay" }));
    await user.type(screen.getByLabelText("Reason"), REASON);
    await user.click(
      screen.getByRole("button", { name: "Replay this callback" }),
    );

    expect(await screen.findByText("Replay started.")).toBeVisible();
    const submitted = replay.mock.calls[0]?.[0] as FormData;
    expect(submitted.get("provider")).toBe("stripe");
    expect(submitted.get("providerEventId")).toBe("evt_1J4k");
    expect(submitted.get("reason")).toBe(REASON);
  });
});
