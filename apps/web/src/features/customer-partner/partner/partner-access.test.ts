import { describe, expect, it } from "vitest";

import { partnerSurfaces } from "./partner-data";
import {
  canReadPartnerChannel,
  partnerAdminOnlyChannels,
} from "./partner-access";

describe("partner channel read authority", () => {
  it("stays equal to the surface catalogue's admin-only set", () => {
    const configured = Object.entries(partnerSurfaces)
      .filter(([, config]) =>
        config.roles.every((role) => role === "partner_admin"),
      )
      .map(([surface]) => surface)
      .sort();

    expect([...partnerAdminOnlyChannels].sort()).toEqual(configured);
  });

  it("admits sellers only to shared partner channels", () => {
    expect(canReadPartnerChannel(["partner_seller"], "portfolio")).toBe(true);
    expect(canReadPartnerChannel(["partner_seller"], "billing")).toBe(false);
    expect(canReadPartnerChannel(["partner_seller"], "commissions")).toBe(
      false,
    );
    expect(canReadPartnerChannel(["partner_admin"], "commissions")).toBe(true);
  });
});
