import { ids } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import { FakeReadOnlySupportFeed } from "./index";

describe("read-only support feed contract", () => {
  it("isolates account signals and offers no write surface", async () => {
    const accountId = ids.account.parse("10000000-0000-4000-8000-000000000308");
    const otherAccountId = ids.account.parse(
      "10000000-0000-4000-8000-000000000309",
    );
    const feed = new FakeReadOnlySupportFeed();
    feed.seed(
      {
        externalId: "ticket-308",
        accountId,
        severity: "high",
        category: "provisioning",
        summary: "Provisioning is delayed",
        openedAt: "2026-07-30T12:00:00.000Z",
        updatedAt: "2026-07-31T15:00:00.000Z",
        status: "open",
      },
      {
        externalId: "ticket-other",
        accountId: otherAccountId,
        severity: "critical",
        category: "privacy",
        summary: "Must not cross tenant boundary",
        openedAt: "2026-07-30T12:00:00.000Z",
        updatedAt: "2026-07-31T15:00:00.000Z",
        status: "open",
      },
    );
    const result = await feed.listSignals({ accountId });
    expect(result).toMatchObject({
      ok: true,
      value: { items: [{ externalId: "ticket-308" }], nextCursor: null },
    });
    expect("createTicket" in feed).toBe(false);
    expect("updateTicket" in feed).toBe(false);
  });
});
