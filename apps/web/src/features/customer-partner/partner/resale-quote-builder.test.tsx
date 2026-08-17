import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PartnerQuoteContext } from "./resale-quote-model";

const sendCoreCommand = vi.fn<(input: unknown) => Promise<unknown>>();
vi.mock("@/src/features/contracts/commerce-client", () => ({
  sendCoreCommand: (input: unknown) => sendCoreCommand(input),
}));

const { ResaleQuoteBuilder } = await import("./resale-quote-builder");

/**
 * `CLOCKWORK_TEST_CLOCK` pins the whole process clock in
 * `scripts/release-suites.mjs`, so it is honoured when set -- and then the
 * surface is driven a year past it. That puts every case here beyond
 * `2026-08-31T17:00`, the expiry this form used to ship as a literal, so no
 * pinned clock can hide a default that has lapsed.
 */
const clock = new Date(
  Date.parse(process.env.CLOCKWORK_TEST_CLOCK ?? "2026-08-15T12:00:00.000Z") +
    365 * 86_400_000,
);

const redwoodOffer = {
  id: "1a2b3c4d-1111-4111-8111-111111111111:LOCKED-STORAGE-TB:us-east-2",
  name: "LOCKED-STORAGE-TB · us-east-2 · Redwood USD 2026 (USD)",
  priceBookId: "1a2b3c4d-1111-4111-8111-111111111111",
  sku: "LOCKED-STORAGE-TB",
  region: "us-east-2",
  currency: "USD",
};
const redwoodClient = {
  id: "5e6f7a8b-1111-4111-8111-111111111111",
  name: "Halcyon Research Cooperative",
  quoteCurrency: "USD",
};
const redwood: PartnerQuoteContext = {
  partnerAccountId: "8f6bb5c6-4f0a-4a2b-9f2d-4c0f1c9b7d31",
  partnerAccountName: "Redwood Channel Group",
  route: "resale",
  offers: [redwoodOffer],
  endClients: [redwoodClient],
};

const blueHarborOffer = {
  id: "1a2b3c4d-9999-4999-8999-999999999999:LOCKED-STORAGE-TB:eu-west-1",
  name: "LOCKED-STORAGE-TB · eu-west-1 · Blue Harbor EUR 2026 (EUR)",
  priceBookId: "1a2b3c4d-9999-4999-8999-999999999999",
  sku: "LOCKED-STORAGE-TB",
  region: "eu-west-1",
  currency: "EUR",
};
const blueHarborClient = {
  id: "5e6f7a8b-9999-4999-8999-999999999999",
  name: "Atlas Field Imaging",
  quoteCurrency: "EUR",
};
const blueHarbor: PartnerQuoteContext = {
  partnerAccountId: "22222222-2222-4222-8222-222222222222",
  partnerAccountName: "Blue Harbor MSP",
  route: "resale",
  offers: [blueHarborOffer],
  endClients: [blueHarborClient],
};

/** Every name the selectors offer, which lives in `value`, not in text. */
function offeredNames(): string[] {
  return [...document.querySelectorAll("datalist option")].map(
    (option) => (option as HTMLOptionElement).value,
  );
}

function quoteSummary(): HTMLElement {
  return screen.getByRole("complementary", { name: "Quote summary" });
}

/** Fills the three stages from an untouched form, touching no expiry field. */
async function reachReviewStage(
  user: ReturnType<typeof userEvent.setup>,
  context: PartnerQuoteContext,
  offerName: string,
  endClientName: string,
) {
  render(<ResaleQuoteBuilder context={context} />);
  await user.type(screen.getByLabelText("Offer and price book"), offerName);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  await user.type(screen.getByLabelText("Committed capacity (TB)"), "120");
  await user.type(screen.getByLabelText("Term (months)"), "12");
  await user.type(screen.getByLabelText("End client"), endClientName);
  if (context.route !== "referral")
    await user.type(screen.getByLabelText(/Partner resale price/), "68400");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return screen.getByRole("button", { name: "Create priced draft" });
}

function useClock() {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(clock);
  });
  afterEach(() => {
    vi.useRealTimers();
    sendCoreCommand.mockReset();
  });
}

describe("what the partner quote builder states before anyone types", () => {
  useClock();

  it("names no deal and no counterparty on first render", () => {
    render(<ResaleQuoteBuilder context={redwood} />);
    const summary = quoteSummary();
    expect(summary).toHaveTextContent("Offer: Not selected");
    expect(summary).toHaveTextContent("End client: Not selected");
    expect(summary).toHaveTextContent("Partner resale price: Not set");
    expect(summary).not.toHaveTextContent("68,400");
    expect(summary).not.toHaveTextContent(redwoodClient.name);
  });

  it("states the acting partner as merchant of record and prints its own ID", async () => {
    const user = userEvent.setup();
    render(<ResaleQuoteBuilder context={redwood} />);
    const summary = quoteSummary();
    expect(summary).toHaveTextContent(
      "Merchant of record: Redwood Channel Group",
    );
    expect(summary).not.toHaveTextContent("Blue Harbor MSP");
    await user.click(screen.getByText("Technical details"));
    expect(summary).toHaveTextContent(redwood.partnerAccountId);
    expect(summary).not.toHaveTextContent(blueHarbor.partnerAccountId);
  });

  it("renders the persisted route as a consequence, never an editable choice", () => {
    const resale = render(<ResaleQuoteBuilder context={redwood} />);
    const resaleBoundary = screen.getByRole("region", {
      name: "Resale",
    });
    expect(resaleBoundary).toHaveTextContent(
      "partner is merchant of record to the named end client",
    );
    expect(resaleBoundary).toHaveTextContent(
      "route is fixed when this quote is issued",
    );
    expect(screen.queryByRole("radio")).toBeNull();
    resale.unmount();

    render(
      <ResaleQuoteBuilder context={{ ...redwood, route: "distributor" }} />,
    );
    const distributorBoundary = screen.getByRole("region", {
      name: "Two-tier distributor",
    });
    expect(distributorBoundary).toHaveTextContent(
      "saved transfer tier is distributor",
    );
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("states sourced attribution from the persisted resale route without a capture control", () => {
    render(<ResaleQuoteBuilder context={redwood} />);
    const summary = quoteSummary();
    expect(summary).toHaveTextContent(
      "Route attribution: Redwood Channel Group is the sourced partner because this route binds an approved deal registration. Merchant of record: Redwood Channel Group.",
    );
    expect(screen.queryByRole("textbox", { name: /attribution/i })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: /influence/i })).toBeNull();
  });

  it("shows one partner nothing belonging to the other", async () => {
    const user = userEvent.setup();
    // The two selectors belong to different stages, so each is read where it
    // is mounted rather than both at once.
    async function selectorsFor(offerName: string) {
      const offers = offeredNames();
      await user.type(screen.getByLabelText("Offer and price book"), offerName);
      await user.click(screen.getByRole("button", { name: "Continue" }));
      return [...offers, ...offeredNames()];
    }

    const first = render(<ResaleQuoteBuilder context={redwood} />);
    expect(await selectorsFor(redwoodOffer.name)).toEqual([
      redwoodOffer.name,
      redwoodClient.name,
    ]);
    expect(document.body).not.toHaveTextContent("Blue Harbor MSP");
    first.unmount();

    render(<ResaleQuoteBuilder context={blueHarbor} />);
    expect(await selectorsFor(blueHarborOffer.name)).toEqual([
      blueHarborOffer.name,
      blueHarborClient.name,
    ]);
    expect(document.body).toHaveTextContent("Blue Harbor MSP");
    expect(document.body).not.toHaveTextContent("Redwood Channel Group");
  });

  it("refuses an offer that belongs to another partner", async () => {
    const user = userEvent.setup();
    render(<ResaleQuoteBuilder context={redwood} />);
    await user.type(
      screen.getByLabelText("Offer and price book"),
      blueHarborOffer.name,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select an available offer by name.",
    );
  });

  it("says why nothing can be quoted rather than showing an empty picker", () => {
    const withoutClients = render(
      <ResaleQuoteBuilder context={{ ...redwood, endClients: [] }} />,
    );
    expect(
      screen.getByText("No end client is available to quote"),
    ).toBeVisible();
    withoutClients.unmount();

    render(<ResaleQuoteBuilder context={{ ...redwood, offers: [] }} />);
    expect(screen.getByText("No offer is available to quote")).toBeVisible();
  });
});

describe("the commercial route the persisted agreement decides", () => {
  useClock();

  it("never offers a referral partner a price it may not set", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockResolvedValue({});
    const referral: PartnerQuoteContext = { ...redwood, route: "referral" };
    const submit = await reachReviewStage(
      user,
      referral,
      redwoodOffer.name,
      redwoodClient.name,
    );
    expect(screen.queryByLabelText(/Partner resale price/)).toBeNull();
    expect(quoteSummary()).toHaveTextContent("Merchant of record: Fil One");
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);
    await screen.findByRole("status");
    const command = sendCoreCommand.mock.lastCall?.[0] as {
      payload: Record<string, unknown>;
    };
    expect(command.payload.route).toBe("referral");
    expect(command.payload).not.toHaveProperty("partnerResaleTotal");
  });

  it("refuses a book whose currency is not the one the client is billed in", async () => {
    const user = userEvent.setup();
    const mixed: PartnerQuoteContext = {
      ...redwood,
      offers: [redwoodOffer, { ...blueHarborOffer, currency: "EUR" }],
      endClients: [redwoodClient],
    };
    render(<ResaleQuoteBuilder context={mixed} />);
    await user.type(
      screen.getByLabelText("Offer and price book"),
      blueHarborOffer.name,
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(screen.getByLabelText("Committed capacity (TB)"), "120");
    await user.type(screen.getByLabelText("Term (months)"), "12");
    await user.type(screen.getByLabelText("End client"), redwoodClient.name);
    await user.type(screen.getByLabelText(/Partner resale price/), "68400");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select an offer priced in USD",
    );
    expect(sendCoreCommand).not.toHaveBeenCalled();
  });
});

describe("resale quote builder submission states", () => {
  useClock();

  it("carries an untouched expiry and the selected rate card into the command", async () => {
    const user = userEvent.setup();
    sendCoreCommand.mockResolvedValue({});
    const submit = await reachReviewStage(
      user,
      redwood,
      redwoodOffer.name,
      redwoodClient.name,
    );
    await user.click(screen.getByRole("checkbox"));
    await user.click(submit);
    await screen.findByRole("status");
    expect(sendCoreCommand).toHaveBeenCalledTimes(1);
    const command = sendCoreCommand.mock.lastCall?.[0] as {
      accountId: string;
      payload: {
        partnerAccountId: string;
        priceBookId: string;
        route: string;
        expiresAt: string;
        lines: { sku: string; region: string; quantity: string }[];
        partnerResaleTotal: { currency: string };
      };
    };
    expect(command.payload.partnerAccountId).toBe(redwood.partnerAccountId);
    expect(command.accountId).toBe(redwoodClient.id);
    expect(command.payload.priceBookId).toBe(redwoodOffer.priceBookId);
    expect(command.payload.route).toBe("resale");
    // The rate card the offer is, not a SKU or region literal no price book
    // has ever carried -- which the command answers with a 500.
    expect(command.payload.lines[0]).toMatchObject({
      sku: redwoodOffer.sku,
      region: redwoodOffer.region,
      quantity: "120",
    });
    expect(command.payload.partnerResaleTotal.currency).toBe("USD");
    expect(Date.parse(command.payload.expiresAt)).toBeGreaterThan(
      clock.getTime(),
    );
  });

  it("explains why the primary action is disabled before confirmation", async () => {
    const user = userEvent.setup();
    const submit = await reachReviewStage(
      user,
      redwood,
      redwoodOffer.name,
      redwoodClient.name,
    );
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
    const submit = await reachReviewStage(
      user,
      redwood,
      redwoodOffer.name,
      redwoodClient.name,
    );
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
    const submit = await reachReviewStage(
      user,
      redwood,
      redwoodOffer.name,
      redwoodClient.name,
    );
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
