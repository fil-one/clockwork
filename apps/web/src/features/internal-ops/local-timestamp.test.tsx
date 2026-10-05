import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalTimestamp } from "./local-timestamp";

const instant = "2026-10-04T23:35:00.000Z";

afterEach(() => {
  process.env.TZ = "UTC";
  document.body.innerHTML = "";
});

describe("LocalTimestamp", () => {
  it("shows the instant in the reader's zone, named, with UTC on hover", () => {
    process.env.TZ = "America/New_York";
    render(<LocalTimestamp value={instant} />);
    const time = screen.getByText("Oct 4, 2026, 7:35 PM EDT");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", instant);
    expect(time).toHaveAttribute("title", "Oct 4, 2026, 11:35 PM UTC");
  });

  it("names the reader's zone on the other side of UTC", () => {
    process.env.TZ = "Asia/Tokyo";
    render(<LocalTimestamp value={instant} locale="en-GB" />);
    expect(screen.getByText("5 Oct 2026, 08:35 GMT+9")).toBeVisible();
  });

  it("drops the hover copy when the reader is already on UTC", () => {
    render(<LocalTimestamp value={instant} />);
    const time = screen.getByText("Oct 4, 2026, 11:35 PM UTC");
    expect(time).not.toHaveAttribute("title");
  });

  it("writes UTC on the server and moves to the reader's zone after hydration without a mismatch", async () => {
    const serverHtml = renderToString(<LocalTimestamp value={instant} />);
    expect(serverHtml).toContain("Oct 4, 2026, 11:35 PM UTC");

    process.env.TZ = "America/Los_Angeles";
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.append(container);
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <LocalTimestamp value={instant} />, {
        onRecoverableError,
      });
      await Promise.resolve();
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.textContent).toBe("Oct 4, 2026, 4:35 PM PDT");
    act(() => root?.unmount());
  });

  it("shows a dash for an instant it cannot read", () => {
    render(<LocalTimestamp value="not a date" />);
    expect(screen.getByText("—")).toBeVisible();
  });
});
