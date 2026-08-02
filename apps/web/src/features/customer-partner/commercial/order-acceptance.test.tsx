import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { OrderAcceptance, type AcceptableQuote } from "./order-acceptance";

const account = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Northstar Archive Labs",
};
const quote: AcceptableQuote = {
  id: "40000000-0000-4000-8000-000000000001",
  reference: "Q-2026-0165-v2",
  title: "Compliance replica renewal",
  version: "2",
  scope: "120 TB · UK South · annual · direct",
  spend: "$55,440.00",
  acceptedLabel: "Accepted Jul 25",
};

function renderSurface(
  overrides: Partial<Parameters<typeof OrderAcceptance>[0]> = {},
) {
  return render(
    <OrderAcceptance
      account={account}
      agreement={{ title: "Cloud Service Agreement", version: "3.2" }}
      orderFormDocumentId={null}
      quote={quote}
      signerUserId="20000000-0000-4000-8000-000000000002"
      {...overrides}
    />,
  );
}

describe("order acceptance", () => {
  it("presents the binding promise chain before the acceptance inputs", () => {
    renderSurface();

    const chain = screen.getByRole("list", {
      name: "Commercial promise chain",
    });
    expect(chain).toHaveTextContent(
      "Accepted quote Q-2026-0165-v2 · version 2",
    );
    expect(chain).toHaveTextContent("Order authority and service start");
    expect(chain).toHaveTextContent(
      "Service commitment and provisioning state",
    );
    expect(
      screen.getByRole("group", { name: "Acceptance inputs" }),
    ).toBeVisible();
  });

  it("leaves every binding acceptance input blank", () => {
    renderSurface();

    expect(screen.getByLabelText("Purchase order")).toHaveValue("");
    expect(screen.getByLabelText("Service start")).toHaveValue("");
    expect(screen.getByLabelText("Authority title")).toHaveValue("");
  });

  it("announces the first missing acceptance input and moves focus to it", async () => {
    const user = userEvent.setup();
    renderSurface();

    const purchaseOrder = screen.getByLabelText("Purchase order");
    await user.click(
      screen.getByRole("button", {
        name: "Accept order and create commitment",
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter the purchase order reference.",
    );
    expect(purchaseOrder).toHaveFocus();
    expect(purchaseOrder).toHaveAttribute("aria-invalid", "true");
  });

  it("requires the explicit commitment confirmation after valid inputs", async () => {
    const user = userEvent.setup();
    renderSurface();

    await user.type(screen.getByLabelText("Purchase order"), "PO-NA-1092");
    await user.type(screen.getByLabelText("Service start"), "2026-08-15");
    await user.type(
      screen.getByLabelText("Authority title"),
      "Chief Operating Officer",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Accept order and create commitment",
      }),
    );

    const confirmation = screen.getByRole("checkbox");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Confirm the reviewed commitment before accepting.",
    );
    expect(confirmation).toHaveFocus();
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    expect(confirmation).toHaveAttribute(
      "aria-describedby",
      "order-validation",
    );
  });

  it("offers no acceptance action without an acceptable quote", () => {
    renderSurface({ quote: null });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No acceptable quote is selected",
    );
    expect(
      screen.queryByRole("button", {
        name: "Accept order and create commitment",
      }),
    ).not.toBeInTheDocument();
  });
});
