import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { QuoteBuilder } from "./quote-builder";

describe("three-stage quote builder", () => {
  it("anchors the draft in the agreement-to-order promise chain", () => {
    render(<QuoteBuilder />);

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

  it("shows inline selector validation and focuses the first invalid field", async () => {
    const user = userEvent.setup();
    render(<QuoteBuilder />);
    const customer = screen.getByLabelText("Customer account");
    await user.clear(customer);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a customer");
    expect(customer).toHaveFocus();
  });

  it("moves through the three review stages without exposing raw ID inputs", async () => {
    const user = userEvent.setup();
    render(<QuoteBuilder />);
    expect(
      screen.queryByLabelText(/account id|price book id/i),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", {
        name: "Capacity, term, route, end client or partner, and expiry",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByRole("heading", { name: "Review and issue" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create priced draft" }),
    ).toBeEnabled();
  });
});
