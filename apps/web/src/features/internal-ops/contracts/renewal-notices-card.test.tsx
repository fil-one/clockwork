import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ staff: vi.fn(), summary: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getRequestCommerceSession: vi.fn() }));
vi.mock("./demo-access", () => ({
  contractReader: mocks.staff,
  contractRegisterReader: () => ({ renewalSummary: mocks.summary }),
}));
import {
  loadRenewalSummary,
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
  expect(await loadRenewalSummary()).toBeNull();
  expect(mocks.summary).not.toHaveBeenCalled();
});

it("leaves the card out when the register cannot be read", async () => {
  mocks.staff.mockResolvedValueOnce({});
  mocks.summary.mockRejectedValueOnce(new Error("db down"));
  // The home page reads this beside its other sections and relies on it
  // never rejecting.
  await expect(loadRenewalSummary()).resolves.toBeNull();
  expect(mocks.summary).toHaveBeenCalledOnce();
});
