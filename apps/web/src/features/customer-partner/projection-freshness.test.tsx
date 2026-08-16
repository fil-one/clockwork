import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectionFreshnessNotice } from "./projection-freshness";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const london = { locale: "en-GB", timeZone: "Europe/London" };
const newYork = { locale: "en-US", timeZone: "America/New_York" };
const generatedAt = "2026-08-14T13:04:00Z";

beforeEach(() => refresh.mockClear());

describe("stale disclosure on a customer or partner surface", () => {
  it("names the read as stale and offers the refresh the operator queue offers", async () => {
    const user = userEvent.setup();
    render(
      <ProjectionFreshnessNotice
        formatting={newYork}
        freshness={{ generatedAt, partial: false, stale: true }}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("These records may be out of date.");
    await user.click(screen.getByRole("button", { name: "Refresh records" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("says the read is current without shouting when it is", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={newYork}
        freshness={{ generatedAt, partial: false, stale: false }}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Records are current");
    // A refresh control on a current read is noise; the reader has nothing to
    // resolve.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("carries the machine-readable instant whichever zone it is shown in", () => {
    render(
      <ProjectionFreshnessNotice
        formatting={london}
        freshness={{ generatedAt, partial: false, stale: false }}
      />,
    );

    expect(screen.getByRole("status").querySelector("time")).toHaveAttribute(
      "dateTime",
      generatedAt,
    );
  });

  it("renders the reader's own zone and names it", () => {
    const { unmount } = render(
      <ProjectionFreshnessNotice
        formatting={newYork}
        freshness={{ generatedAt, partial: false, stale: false }}
      />,
    );
    // 13:04Z is 09:04 in New York and 14:04 in London. Before this the second
    // reader was shown the first reader's clock, unlabelled.
    expect(screen.getByRole("status")).toHaveTextContent("9:04");
    expect(screen.getByRole("status")).toHaveTextContent("EDT");
    unmount();

    render(
      <ProjectionFreshnessNotice
        formatting={london}
        freshness={{ generatedAt, partial: false, stale: false }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("14:04");
    expect(screen.getByRole("status")).toHaveTextContent("BST");
  });
});
