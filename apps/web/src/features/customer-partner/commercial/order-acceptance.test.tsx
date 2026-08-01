import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { OrderAcceptance } from "./order-acceptance";

describe("order acceptance", () => {
  it("presents the binding promise chain before the acceptance inputs", () => {
    render(<OrderAcceptance />);

    const chain = screen.getByRole("list", {
      name: "Commercial promise chain",
    });
    expect(chain).toHaveTextContent("Accepted quote · version 2");
    expect(chain).toHaveTextContent("Order authority and service start");
    expect(chain).toHaveTextContent(
      "Service commitment and provisioning state",
    );
    expect(
      screen.getByRole("group", { name: "Acceptance inputs" }),
    ).toBeVisible();
  });

  it("announces the first missing acceptance input and moves focus to it", async () => {
    const user = userEvent.setup();
    render(<OrderAcceptance />);

    const purchaseOrder = screen.getByLabelText("Purchase order");
    await user.clear(purchaseOrder);
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
    render(<OrderAcceptance />);

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
});
