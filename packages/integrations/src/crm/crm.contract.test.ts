import {
  EventEnvelopeSchema,
  IdempotencyKeySchema,
  ids,
} from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import { FakeCrmProjectionAdapter } from "./index";

describe("CRM outbound projection contract", () => {
  it("projects an allow-listed, idempotent view while commerce stays authoritative", async () => {
    const accountId = ids.account.parse("10000000-0000-4000-8000-000000000305");
    const event = EventEnvelopeSchema.parse({
      id: "11111111-1111-4111-8111-111111111305",
      specVersion: "1.0",
      eventVersion: 1,
      type: "account.registered",
      occurredAt: "2026-07-31T16:00:00.000Z",
      requestId: "crm-contract-305",
      aggregate: { type: "account", id: accountId, version: 3 },
      actor: { kind: "system", id: "crm-contract" },
      data: {
        legalName: "CRM Projection Customer",
        country: "US",
        status: "registered",
        transferPrice: "NEVER_PROJECT",
        acceptanceIp: "192.0.2.10",
      },
    });
    const adapter = new FakeCrmProjectionAdapter();
    const idempotencyKey = IdempotencyKeySchema.parse(
      "crm:account:registered:305",
    );
    const first = await adapter.project({ event, idempotencyKey });
    const replay = await adapter.project({ event, idempotencyKey });
    expect(first.ok && replay.ok).toBe(true);
    expect(replay.ok && replay.duplicate).toBe(true);
    expect(adapter.writes).toHaveLength(1);
    expect(adapter.writes[0]?.fields).toMatchObject({
      legalName: "CRM Projection Customer",
      commerceAggregateVersion: 3,
    });
    expect(adapter.writes[0]?.fields).not.toHaveProperty("transferPrice");
    expect(adapter.writes[0]?.fields).not.toHaveProperty("acceptanceIp");
  });
});
