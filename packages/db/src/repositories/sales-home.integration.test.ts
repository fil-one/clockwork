import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";

import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import { createRuntimeDatabase } from "../client";
import { countSalesHomeMndas } from "./sales-home";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

const now = new Date("2026-10-04T12:00:00.000Z");
const since = new Date("2026-09-04T12:00:00.000Z");

async function request(
  ownerId: string,
  state: string,
  completedAt: Date | null = null,
) {
  const input = { ...fixtureInput, id: randomUUID() };
  await client`
    insert into commerce_mnda_requests
      (id, input, countersigner, owner_id, owner_name, state, template_hash,
       test_mode, completed_at)
    values (${input.id}, ${JSON.stringify(input)}::jsonb,
      ${JSON.stringify(fixtureSigner)}::jsonb, ${ownerId}::uuid, 'Seller',
      ${state}, ${"a".repeat(64)}, true,
      ${completedAt?.toISOString() ?? null}::timestamptz)`;
}

it("counts a seller's MNDAs by what they wait on, beside the team's", async () => {
  const seller = randomUUID();
  const colleague = randomUUID();
  const before = await countSalesHomeMndas(db, {
    ownerId: seller,
    completedSince: since,
  });
  expect(before.mine).toEqual({
    waitingPartner: 0,
    waitingFilOne: 0,
    completed: 0,
    drafts: 0,
  });

  await request(seller, "sent");
  await request(seller, "viewed");
  await request(seller, "awaiting_countersignature");
  await request(seller, "completed", new Date("2026-10-01T00:00:00.000Z"));
  // Completed before the window: archive, not recent work.
  await request(seller, "completed", new Date("2026-08-01T00:00:00.000Z"));
  await request(seller, "ready");
  await request(seller, "canceled");
  await request(colleague, "sent");
  await request(colleague, "draft");

  const after = await countSalesHomeMndas(db, {
    ownerId: seller,
    completedSince: since,
    requestId: `sales-home-test:${now.toISOString()}`,
  });
  expect(after.mine).toEqual({
    waitingPartner: 2,
    waitingFilOne: 1,
    completed: 1,
    drafts: 1,
  });
  expect(after.team.waitingPartner - before.team.waitingPartner).toBe(3);
  expect(after.team.waitingFilOne - before.team.waitingFilOne).toBe(1);
  expect(after.team.completed - before.team.completed).toBe(1);
  expect(after.team.drafts - before.team.drafts).toBe(2);
});
