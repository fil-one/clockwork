import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuoteBuilder } from "./quote-builder";

const sendCoreCommand = vi.fn<(input: unknown) => Promise<unknown>>();
vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: (input: unknown) => sendCoreCommand(input),
}));

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};

function unloadWouldWarn(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

async function enterAQuote(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Offer"),
    "Enterprise archive capacity",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(screen.getByLabelText("Committed capacity (TB)"), "120");
  await user.type(screen.getByLabelText("Term (months)"), "12");
  await user.type(screen.getByLabelText("Quote expiry"), "2026-08-31T17:00");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

// Reset after rather than before: resetting between the unmount and the next
// render leaves the rejected-submission test's promise unowned, and vitest
// reports it as an unhandled rejection against the test that already passed.
afterEach(() => sendCoreCommand.mockReset());

/**
 * Two stages of entry used to be one stray click from gone: the header's
 * "Cancel and return" was a bare link, and there was no `beforeunload` handler
 * anywhere in the repository. Both halves are exercised here because neither
 * covers the other -- a client-side link never unloads the document.
 */
describe("quote builder unsaved-work protection", () => {
  it("guards neither reload nor cancel while the form holds only its defaults", () => {
    render(<QuoteBuilder account={account} />);

    expect(unloadWouldWarn()).toBe(false);
    expect(
      screen.getByRole("link", { name: "Cancel and return" }),
    ).toHaveAttribute("href", "/quotes");
  });

  it("guards a reload as soon as one field is filled in", async () => {
    const user = userEvent.setup();
    render(<QuoteBuilder account={account} />);

    await user.type(screen.getByLabelText("Offer"), "Enterprise");

    expect(unloadWouldWarn()).toBe(true);
  });

  it("asks before the header link throws two stages of entry away", async () => {
    const user = userEvent.setup();
    render(<QuoteBuilder account={account} />);
    await enterAQuote(user);

    await user.click(screen.getByRole("button", { name: "Cancel and return" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Leave without saving?",
    );
    expect(
      screen.getByRole("link", { name: "Discard and leave" }),
    ).toHaveAttribute("href", "/quotes");
  });

  it("stops guarding once the server has the draft", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockResolvedValue({});
    render(<QuoteBuilder account={account} />);
    await enterAQuote(user);
    expect(unloadWouldWarn()).toBe(true);

    await user.click(
      screen.getByRole("button", { name: "Create priced draft" }),
    );
    await screen.findByRole("status");

    expect(sendCoreCommand).toHaveBeenCalledTimes(1);
    expect(unloadWouldWarn()).toBe(false);
    expect(
      screen.getByRole("link", { name: "Cancel and return" }),
    ).toBeVisible();
  });

  it("keeps guarding when the server refused the draft", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockRejectedValue(new Error("Rate card is not activated"));
    render(<QuoteBuilder account={account} />);
    await enterAQuote(user);

    await user.click(
      screen.getByRole("button", { name: "Create priced draft" }),
    );
    await screen.findByText("Rate card is not activated");

    // Nothing was recorded, so everything on the form is still unsaved.
    expect(unloadWouldWarn()).toBe(true);
  });

  it("guards again when the reader edits after a successful create", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockResolvedValue({});
    render(<QuoteBuilder account={account} />);
    await enterAQuote(user);
    await user.click(
      screen.getByRole("button", { name: "Create priced draft" }),
    );
    await screen.findByRole("status");
    expect(unloadWouldWarn()).toBe(false);

    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.type(screen.getByLabelText("Committed capacity (TB)"), "5");

    expect(unloadWouldWarn()).toBe(true);
  });
});
