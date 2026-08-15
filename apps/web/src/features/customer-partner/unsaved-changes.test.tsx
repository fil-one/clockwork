import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { LeaveDraftControl, useUnsavedChangesWarning } from "./unsaved-changes";

/** Whether the page would currently ask the browser to stop an unload. */
function unloadWouldWarn(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function Harness({ start = false }: { start?: boolean }) {
  const [armed, setArmed] = useState(start);
  useUnsavedChangesWarning(armed);
  return (
    <>
      <button onClick={() => setArmed(true)} type="button">
        Type something
      </button>
      <button onClick={() => setArmed(false)} type="button">
        Submit
      </button>
    </>
  );
}

describe("beforeunload arming", () => {
  it("does not warn on a form nobody has touched", () => {
    render(<Harness />);

    expect(unloadWouldWarn()).toBe(false);
  });

  it("warns once there is input the server has not taken", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Type something" }));

    expect(unloadWouldWarn()).toBe(true);
  });

  /**
   * The failure mode a naive implementation ships: a listener attached for the
   * lifetime of the component fires on the way out of a completed submission,
   * which teaches people to dismiss the prompt and so disarms it for the case
   * it exists for.
   */
  it("stops warning the moment the work is saved", async () => {
    const user = userEvent.setup();
    render(<Harness start />);
    expect(unloadWouldWarn()).toBe(true);

    await user.click(screen.getByRole("button", { name: "Submit" }));

    expect(unloadWouldWarn()).toBe(false);
  });

  it("leaves nothing attached after the form unmounts", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Type something" }));
    expect(unloadWouldWarn()).toBe(true);

    unmount();

    expect(unloadWouldWarn()).toBe(false);
  });
});

describe("in-application leave control", () => {
  /**
   * `beforeunload` cannot cover this click: an App Router link never unloads
   * the document. Unarmed the control must stay exactly the one-click link it
   * always was -- a confirmation in front of an untouched form is an obstacle
   * to a legitimate operation, not a protection.
   */
  it("is a plain link while there is nothing to lose", () => {
    render(
      <LeaveDraftControl
        armed={false}
        href="/quotes"
        label="Cancel and return"
      />,
    );

    expect(
      screen.getByRole("link", { name: "Cancel and return" }),
    ).toHaveAttribute("href", "/quotes");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks before discarding entered work, and still lets the reader go", async () => {
    const user = userEvent.setup();
    render(
      <LeaveDraftControl armed href="/quotes" label="Cancel and return" />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel and return" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Leave without saving?",
    );
    // Never a refusal: leaving is always one further click away.
    expect(
      screen.getByRole("link", { name: "Discard and leave" }),
    ).toHaveAttribute("href", "/quotes");
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
  });

  it("returns to the form when the reader keeps editing", async () => {
    const user = userEvent.setup();
    render(
      <LeaveDraftControl armed href="/quotes" label="Cancel and return" />,
    );

    await user.click(screen.getByRole("button", { name: "Cancel and return" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Cancel and return" }),
    ).toBeVisible();
  });

  it("drops an open prompt when the work is saved underneath it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <LeaveDraftControl armed href="/quotes" label="Cancel and return" />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel and return" }));
    expect(screen.getByRole("alert")).toBeVisible();

    rerender(
      <LeaveDraftControl
        armed={false}
        href="/quotes"
        label="Cancel and return"
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Cancel and return" }),
    ).toBeVisible();
  });
});
