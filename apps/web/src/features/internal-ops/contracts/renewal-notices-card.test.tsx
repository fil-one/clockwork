import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ staff: vi.fn(), summary: vi.fn() }));
vi.mock("./demo-access", () => ({
  contractReader: mocks.staff,
  contractRegisterReader: () => ({ renewalSummary: mocks.summary }),
}));
import {
  RenewalNoticesCard,
  RenewalNoticesSummary,
} from "./renewal-notices-card";

it("counts notices due soon and links to the full list", async () => {
  render(
    await RenewalNoticesSummary({
      summary: {
        within30: 2,
        within60: 3,
        within90: 5,
        passed: 1,
        nextDeadline: "2026-10-05",
      },
    }),
  );
  expect(
    screen.getByText("2 notices due in the next 30 days"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("5 notices due in the next 90 days"),
  ).toBeInTheDocument();
  expect(screen.getByText("Next deadline: Oct 5, 2026")).toBeInTheDocument();
  expect(
    screen.getByText(
      "1 contract renews automatically: its notice deadline has passed",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open renewal notices" }),
  ).toHaveAttribute("href", "/internal/contracts/notices");
});

it("says when nothing is due", async () => {
  render(
    await RenewalNoticesSummary({
      summary: {
        within30: 0,
        within60: 0,
        within90: 0,
        passed: 0,
        nextDeadline: null,
      },
    }),
  );
  expect(
    screen.getByText("No renewal notices are due in the next 90 days."),
  ).toBeInTheDocument();
});

it("shows nothing to people who cannot read contracts", async () => {
  mocks.staff.mockRejectedValue(new Error("CONTRACT_FORBIDDEN"));
  expect(await RenewalNoticesCard()).toBeNull();
  expect(mocks.summary).not.toHaveBeenCalled();
});
