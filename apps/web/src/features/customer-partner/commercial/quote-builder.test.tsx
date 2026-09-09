import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { QuoteBuilder } from "./quote-builder";
import {
  authoritativeQuoteOffer,
  authoritativeQuoteOffers,
} from "./quote-offer.test-fixture";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};

async function completeStageOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Offer"),
    authoritativeQuoteOffer.label,
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function completeStageTwo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Committed capacity (TB)"), "120");
  await user.type(screen.getByLabelText("Term (months)"), "12");
  await user.type(
    screen.getByLabelText("Quote expiry"),
    new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 16),
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("three-stage quote builder", () => {
  it("anchors the draft in the agreement-to-order promise chain", () => {
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        offers={authoritativeQuoteOffers}
      />,
    );

    const chain = screen.getByRole("list", {
      name: "Commercial promise chain",
    });
    expect(chain).toHaveTextContent("Agreement and account authority");
    expect(chain).toHaveTextContent("Quote scope, route, and expiry");
    expect(chain).toHaveTextContent("Order commitment after acceptance");
    expect(
      screen.getByRole("group", { name: "Customer and authoritative offer" }),
    ).toBeVisible();
  });

  it("binds the customer selector to the authorized session account", () => {
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        offers={authoritativeQuoteOffers}
      />,
    );

    expect(screen.getByLabelText("Customer account")).toHaveValue(account.name);
    expect(document.body).not.toHaveTextContent(
      authoritativeQuoteOffer.priceBookId,
    );
    expect(
      screen.getByText(/Choose an available offer for the region/u),
    ).toBeVisible();
  });

  it("seeds only the validated capacity and term handoff", async () => {
    const user = userEvent.setup();
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        initialDraft={{ capacity: "100", termMonths: "12" }}
        offers={authoritativeQuoteOffers}
      />,
    );

    await completeStageOne(user);
    expect(screen.getByLabelText("Committed capacity (TB)")).toHaveValue(100);
    expect(screen.getByLabelText("Term (months)")).toHaveValue(12);
    expect(screen.getByRole("radio", { name: /Direct/u })).toBeChecked();
  });

  it("shows the only route this customer-scoped command can submit", async () => {
    const user = userEvent.setup();
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        offers={authoritativeQuoteOffers}
      />,
    );

    await completeStageOne(user);

    const route = screen.getByRole("radio", { name: /Direct/u });
    expect(route).toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(
      screen.getByText(/customer workspace creates direct quotes only/u),
    ).toBeVisible();
    expect(
      screen.getByText(/route is fixed when this quote is issued/u),
    ).toBeVisible();
    for (const unavailable of [
      "Partner referral",
      "Partner resale",
      "Distributor / two-tier",
      "Marketplace",
    ])
      expect(
        screen.queryByRole("radio", { name: unavailable }),
      ).not.toBeInTheDocument();
  });

  it("names the record a forward link opened the draft from", () => {
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        offers={authoritativeQuoteOffers}
        origin={{
          kind: "revision",
          reference: "Q-2026-0184-v3",
          resolved: true,
        }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Revises quote Q-2026-0184-v3",
    );
  });

  it("shows inline selector validation and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        offers={authoritativeQuoteOffers}
      />,
    );
    const customer = screen.getByLabelText("Customer account");
    await user.clear(customer);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Choose a customer/)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(customer).toHaveFocus();
  });

  it("moves through the three review stages without exposing raw ID inputs", async () => {
    const user = userEvent.setup();
    render(
      <QuoteBuilder
        account={account}
        catalogueMode="authoritative"
        offers={authoritativeQuoteOffers}
      />,
    );
    expect(
      screen.queryByLabelText(/account id|price book id/i),
    ).not.toBeInTheDocument();

    await completeStageOne(user);
    expect(
      screen.getByRole("heading", {
        name: "Capacity, term, and expiry",
      }),
    ).toBeVisible();
    await completeStageTwo(user);
    expect(screen.getByRole("heading", { name: "Review draft" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create priced draft" }),
    ).toBeEnabled();
  });
});
