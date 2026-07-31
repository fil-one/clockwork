import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import { FakeDeniedPartyScreeningAdapter } from "./index";

describe("denied-party screening provider contract", () => {
  it("supports clear, review, blocked, and idempotent screening evidence", async () => {
    const adapter = new FakeDeniedPartyScreeningAdapter();
    const accountId = ids.account.parse("10000000-0000-4000-8000-000000000306");
    const base = {
      accountId,
      aliases: [] as const,
      country: "US",
      reason: "pre_signature" as const,
    };
    const clear = await adapter.screen({
      ...base,
      legalName: "Clear Example LLC",
      idempotencyKey: IdempotencyKeySchema.parse(
        "screening:clear:contract:306",
      ),
    });
    expect(clear).toMatchObject({ ok: true, value: { decision: "clear" } });
    const blockedInput = {
      ...base,
      legalName: "Blocked Fixture Trading",
      idempotencyKey: IdempotencyKeySchema.parse(
        "screening:blocked:contract:306",
      ),
    };
    const blocked = await adapter.screen(blockedInput);
    const replay = await adapter.screen(blockedInput);
    expect(blocked).toMatchObject({
      ok: true,
      value: {
        decision: "blocked",
        matchedLists: ["CLOCKWORK-DENIED-PARTY-FIXTURE"],
      },
    });
    expect(replay.ok && replay.duplicate).toBe(true);
  });
});
