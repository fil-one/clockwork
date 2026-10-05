import { describe, expect, it } from "vitest";

import { permissionsForRoles } from "@clockwork/contracts";

import { partnerSurfaces } from "./partner-data";
import {
  canReadPartnerChannel,
  partnerAdminOnlyChannels,
} from "./partner-access";

const seller = permissionsForRoles(["partner_seller"], {
  side: "channel_partner",
});
const admin = permissionsForRoles(["partner_admin"], {
  side: "channel_partner",
});

describe("partner channel read authority", () => {
  it("asks the same permission the surface catalogue asks of each admin-only channel", () => {
    for (const [surface, permission] of Object.entries(
      partnerAdminOnlyChannels,
    ))
      expect(
        partnerSurfaces[surface as keyof typeof partnerAdminOnlyChannels]
          .requiredPermission,
      ).toBe(permission);
    const shared = Object.entries(partnerSurfaces)
      .filter(([surface]) => !Object.hasOwn(partnerAdminOnlyChannels, surface))
      .map(([, config]) => config.requiredPermission);
    expect(new Set(shared)).toEqual(new Set(["deal:register"]));
  });

  it("admits sellers only to shared partner channels", () => {
    expect(canReadPartnerChannel(seller, "portfolio")).toBe(true);
    expect(canReadPartnerChannel(seller, "billing")).toBe(false);
    expect(canReadPartnerChannel(seller, "commissions")).toBe(false);
    expect(canReadPartnerChannel(admin, "commissions")).toBe(true);
  });

  it("admits a referral partner to every channel its role reaches", () => {
    const referral = permissionsForRoles(["partner_admin"], {
      side: "referral_partner",
    });
    expect(canReadPartnerChannel(referral, "registrations")).toBe(true);
    expect(canReadPartnerChannel(referral, "commissions")).toBe(true);
  });

  it("refuses a session that is not a partner's", () => {
    expect(
      canReadPartnerChannel(permissionsForRoles(["owner"]), "portfolio"),
    ).toBe(false);
    expect(
      canReadPartnerChannel(
        permissionsForRoles(["commerce_admin"], { side: "fil_one" }),
        "portfolio",
      ),
    ).toBe(false);
  });
});
