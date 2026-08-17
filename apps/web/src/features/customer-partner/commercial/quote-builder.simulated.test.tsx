import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendCoreCommand: vi.fn() }));

vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: mocks.sendCoreCommand,
}));

import { QuoteBuilder } from "./quote-builder";
import { authoritativeQuoteOffers } from "./quote-offer.test-fixture";

it("keeps the explicit demo builder operable without claiming a saved priced quote", async () => {
  const user = userEvent.setup();
  mocks.sendCoreCommand.mockResolvedValue({
    record: { rowVersion: 1, data: { route: "direct" } },
  });
  render(
    <QuoteBuilder
      account={{
        id: "10000000-0000-4000-8000-000000000001",
        name: "Northstar Archive Labs",
      }}
      catalogueMode="simulated"
      offers={authoritativeQuoteOffers}
    />,
  );

  await user.type(
    screen.getByLabelText("Offer"),
    authoritativeQuoteOffers[0].label,
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(screen.getByLabelText("Committed capacity (TB)"), "42");
  await user.type(screen.getByLabelText("Term (months)"), "12");
  await user.type(screen.getByLabelText("Quote expiry"), "2026-08-31T17:00");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("button", { name: "Simulate draft" }));

  expect(mocks.sendCoreCommand).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText(/No quote was saved, priced, or issued/u),
  ).toBeVisible();
  expect(screen.queryByRole("link", { name: /Open quote/u })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Create priced draft" }),
  ).toBeNull();
});
