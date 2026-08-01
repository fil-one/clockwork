import { describe, expect, it } from "vitest";

import { marketplaceEventPayloadSchema } from "./schemas";

const valid = {
  type: "metering.reported",
  eventId: "marketplace-event-1",
  provider: "aws" as const,
  providerAccountReference: "seller-account-1",
  accountId: "10000000-0000-4000-8000-000000000001",
  orderId: "50000000-0000-4000-8000-000000000001",
  entitlementId: "60000000-0000-4000-8000-000000000001",
  occurredAt: "2026-08-01T12:00:00.000Z",
  currency: "USD" as const,
  grossMinor: "9223372036854775807",
  feeMinor: "0",
  taxMinor: "0",
  netMinor: "9223372036854775807",
  quantity: "99999999999999999999.999999999999999999",
  sequence: 1,
};

describe("marketplace repository payload boundaries", () => {
  it("accepts the exact database maxima", () => {
    expect(marketplaceEventPayloadSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    ["negative quantity", { quantity: "-1" }],
    ["exponent quantity", { quantity: "1e3" }],
    ["wide quantity", { quantity: "100000000000000000000" }],
    ["over-scale quantity", { quantity: "0.0000000000000000001" }],
    ["bigint overflow", { grossMinor: "9223372036854775808" }],
    ["bigint underflow", { netMinor: "-9223372036854775809" }],
    ["non-integer money", { feeMinor: "1.5" }],
    ["exponent money", { taxMinor: "1e3" }],
  ])("rejects %s before persistence", (_label, override) => {
    expect(
      marketplaceEventPayloadSchema.safeParse({ ...valid, ...override })
        .success,
    ).toBe(false);
  });
});
