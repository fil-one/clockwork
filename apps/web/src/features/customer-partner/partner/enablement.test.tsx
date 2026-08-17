import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PartnerEnablement } from "./enablement";

describe("partner enablement", () => {
  it("separates client-safe destinations from partner records", () => {
    render(
      <PartnerEnablement
        roles={["partner_admin"]}
        partnerName="Redwood Channel Group"
      />,
    );
    const clientSafe = screen.getByRole("region", {
      name: "Share with clients",
    });
    expect(within(clientSafe).getAllByRole("link")).toHaveLength(3);
    expect(
      within(clientSafe).getByText(/Nothing in this section/),
    ).toHaveTextContent(/transfer pricing, commissions, deal registrations/);
    expect(
      within(clientSafe)
        .getAllByRole("link")
        .every((link) => !link.getAttribute("href")?.startsWith("/partner")),
    ).toBe(true);
  });

  it("states the Sales Kit gap without presenting substitute content", () => {
    render(
      <PartnerEnablement
        roles={["partner_seller"]}
        partnerName="Atlas Referral Desk"
      />,
    );
    expect(screen.getByRole("heading", { name: "Sales Kit v1" })).toBeVisible();
    expect(screen.getByText(/have not been published/i)).toBeVisible();
    expect(
      screen.getByText(/Nothing on this page is a placeholder/i),
    ).toBeVisible();
    const internal = screen.getByRole("region", {
      name: "Internal to your desk",
    });
    expect(within(internal).getByText("Register an opportunity")).toBeVisible();
    expect(within(internal).queryByText("Review commissions")).toBeNull();
  });
});
