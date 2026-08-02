import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { QuoteBuilder } from "./quote-builder";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};

async function completeStageOne(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("Offer"),
    "Enterprise archive capacity",
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

async function completeStageTwo(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Committed capacity (TB)"), "120");
  await user.type(screen.getByLabelText("Term (months)"), "12");
  await user.type(screen.getByLabelText("Quote expiry"), "2026-08-31T17:00");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("three-stage quote builder", () => {
  it("anchors the draft in the agreement-to-order promise chain", () => {
    render(<QuoteBuilder account={account} />);

    const chain = screen.getByRole("list", {
      name: "Commercial promise chain",
    });
    expect(chain).toHaveTextContent("Agreement and account authority");
    expect(chain).toHaveTextContent("Quote scope, route, and expiry");
    expect(chain).toHaveTextContent("Order commitment after acceptance");
    expect(
      screen.getByRole("group", { name: "Customer, offer, and region" }),
    ).toBeVisible();
  });

  it("binds the customer selector to the authorized session account", () => {
    render(<QuoteBuilder account={account} />);

    expect(screen.getByLabelText("Customer account")).toHaveValue(account.name);
  });

  it("names the record a forward link opened the draft from", () => {
    render(
      <QuoteBuilder
        account={account}
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
    render(<QuoteBuilder account={account} />);
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
    render(<QuoteBuilder account={account} />);
    expect(
      screen.queryByLabelText(/account id|price book id/i),
    ).not.toBeInTheDocument();

    await completeStageOne(user);
    expect(
      screen.getByRole("heading", {
        name: "Capacity, term, route, end client or partner, and expiry",
      }),
    ).toBeVisible();
    await completeStageTwo(user);
    expect(
      screen.getByRole("heading", { name: "Review and issue" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create priced draft" }),
    ).toBeEnabled();
  });
});
