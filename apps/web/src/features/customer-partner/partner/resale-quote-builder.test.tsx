import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const sendCoreCommand = vi.fn<() => Promise<unknown>>();
vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: () => sendCoreCommand(),
}));

const { ResaleQuoteBuilder } = await import("./resale-quote-builder");

/** Walks the three stages with an expiry that stays valid against any clock. */
async function reachReviewStage(user: ReturnType<typeof userEvent.setup>) {
  render(<ResaleQuoteBuilder />);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(screen.getByLabelText("Quote expiry"), {
    target: { value: "2099-01-01T17:00" },
  });
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return screen.getByRole("button", { name: "Create priced draft" });
}

describe("resale quote builder submission states", () => {
  afterEach(() => {
    sendCoreCommand.mockReset();
  });

  it("explains why the primary action is disabled before confirmation", async () => {
    const user = userEvent.setup();
    const submit = await reachReviewStage(user);
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Confirm the review above/)).toBeVisible();
    await user.click(screen.getByRole("checkbox"));
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/Confirm the review above/)).toBeNull();
  });

  it("announces a rejected submission as an alert, never as success", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockRejectedValue(
      new Error("Quote rejected: margin floor"),
    );
    const submit = await reachReviewStage(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Quote rejected: margin floor",
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(submit).toBeEnabled();
  });

  it("announces an accepted submission as a status and closes the action", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockResolvedValue({});
    const submit = await reachReviewStage(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Draft created from server pricing",
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submit).toBeDisabled();
    expect(screen.getByText(/priced draft was created/)).toBeVisible();
  });
});
