import {
  EventEnvelopeSchema,
  IdempotencyKeySchema,
  ids,
} from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  createCrmProjectionOutboxHandlers,
  crmProjectionTopics,
  FakeCrmAccountRecordStore,
  FakeCrmProjectionAdapter,
  type CrmOutboxDelivery,
} from "./index";

const ACCOUNT_ID = "10000000-0000-4000-8000-000000000401";

function delivery(
  topic: string,
  overrides: Partial<{
    messageId: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    data: Record<string, unknown>;
  }> = {},
): CrmOutboxDelivery {
  const messageId =
    overrides.messageId ?? "22222222-2222-4222-8222-222222222401";
  return {
    messageId,
    eventId: "33333333-3333-4333-8333-333333333401",
    topic,
    idempotencyKey: `outbox:${messageId}`,
    payload: {
      eventId: "33333333-3333-4333-8333-333333333401",
      eventType: overrides.eventType ?? topic,
      aggregateType: overrides.aggregateType ?? aggregateTypeFor(topic),
      aggregateId: overrides.aggregateId ?? ACCOUNT_ID,
      aggregateVersion: 3,
      occurredAt: "2026-07-31T16:00:00.000Z",
      requestId: "crm-consumer-401",
      actor: { kind: "system", id: "crm-consumer" },
      data: overrides.data ?? { legalName: "CRM Projection Customer" },
    },
  };
}

function aggregateTypeFor(topic: string): string {
  if (topic.startsWith("account.")) return "account";
  if (topic.startsWith("renewal.")) return "renewal";
  return topic.split(".")[1]?.replace(/s$/, "") ?? "account";
}

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

/**
 * P0-44: the port, its adapter and its fake existed and nothing called them.
 * These cover the runtime consumer, so a registered topic that projects nothing
 * fails here rather than reading as wired.
 */
describe("CRM projection outbox consumer", () => {
  function consumer() {
    const projection = new FakeCrmProjectionAdapter();
    const accounts = new FakeCrmAccountRecordStore();
    return {
      projection,
      accounts,
      handlers: createCrmProjectionOutboxHandlers({ projection, accounts }),
    };
  }

  it("projects every registered §15 topic", async () => {
    const { projection, handlers } = consumer();
    expect([...handlers.keys()].sort()).toEqual(
      [...crmProjectionTopics].sort(),
    );
    for (const [index, topic] of crmProjectionTopics.entries()) {
      const handler = handlers.get(topic);
      if (!handler) throw new Error(`no handler for ${topic}`);
      await handler(
        delivery(topic, {
          messageId: `22222222-2222-4222-8222-20000000040${index}`,
        }),
      );
    }
    expect(projection.writes).toHaveLength(crmProjectionTopics.length);
    expect(projection.writes.map((write) => write.objectType)).toEqual([
      "account",
      "opportunity",
      "opportunity",
      "opportunity",
      "order",
      "renewal",
      "renewal",
    ]);
  });

  it("writes accounts.crm_record_id from the registration projection", async () => {
    const { projection, accounts, handlers } = consumer();
    const handler = handlers.get("account.registered");
    if (!handler) throw new Error("registration handler expected");
    await handler(delivery("account.registered"));
    expect(accounts.bound.get(ACCOUNT_ID)).toBe(
      projection.writes[0]?.projectionId,
    );
  });

  it("re-presents the same key on redelivery instead of creating a second record", async () => {
    const { projection, accounts, handlers } = consumer();
    const handler = handlers.get("account.registered");
    if (!handler) throw new Error("registration handler expected");
    await handler(delivery("account.registered"));
    await handler(delivery("account.registered"));
    expect(projection.writes).toHaveLength(1);
    expect(accounts.bound.size).toBe(1);
  });

  it("binds nothing for an aggregate that is not the account", async () => {
    const { accounts, handlers } = consumer();
    const handler = handlers.get("core.quotes.issue");
    if (!handler) throw new Error("quote handler expected");
    await handler(delivery("core.quotes.issue"));
    expect(accounts.bound.size).toBe(0);
  });

  it("fails the delivery when the provider rejects it, so the outbox retries", async () => {
    const { projection, accounts, handlers } = consumer();
    const handler = handlers.get("account.registered");
    if (!handler) throw new Error("registration handler expected");
    projection.failNext("transient");
    await expect(handler(delivery("account.registered"))).rejects.toThrow(
      "CRM_PROJECTION_FAILED:transient:CRM_SIMULATED_FAILURE",
    );
    expect(accounts.bound.size).toBe(0);
  });

  it("refuses a payload whose event type is not the topic it arrived on", async () => {
    const { handlers } = consumer();
    const handler = handlers.get("account.registered");
    if (!handler) throw new Error("registration handler expected");
    await expect(
      handler(
        delivery("account.registered", { eventType: "account.selected" }),
      ),
    ).rejects.toThrow("CRM_PROJECTION_TOPIC_EVENT_MISMATCH");
  });
});
