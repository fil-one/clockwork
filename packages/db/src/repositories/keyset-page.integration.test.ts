import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { PartnerListQuerySchema } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../client";
import { PricingScenarioRepository } from "./pricing-scenarios";
import { HandoffRequestRepository } from "./system/handoff-requests";
import { PartnerRepository } from "./partners";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const owner = randomUUID();
const foreign = randomUUID();
const tag = `Pagination ${randomUUID()}`;
const scenarioIds: string[] = [],
  handoffIds: string[] = [],
  partnerIds: string[] = [];
afterAll(async () => {
  await client`delete from commerce_handoff_requests where id = any(${handoffIds})`;
  await client`delete from commerce_contracts where id = any(${handoffIds})`;
  await client`delete from commerce_pricing_scenarios where id = any(${scenarioIds})`;
  await client`delete from commerce_partners where id = any(${partnerIds})`;
  await client.end();
});

async function collect<T extends { id: string }>(
  read: (cursor?: string) => Promise<{ rows: T[]; nextCursor: string | null }>,
) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 40; pageNumber += 1) {
    const page = await read(cursor);
    ids.push(...page.rows.map(({ id }) => id));
    if (!page.nextCursor) return ids;
    expect(page.nextCursor).not.toBe(cursor);
    cursor = page.nextCursor;
  }
  throw new Error("Pagination did not terminate");
}

it("reads beyond the pricing UI cap with ownership filtering, timestamp ties and sub-millisecond precision", async () => {
  const bookId = randomUUID();
  const line = {
    bookId,
    bookVersion: 1,
    rateId: randomUUID(),
    sku: "STORAGE",
    region: "us-east",
    unit: "TB-month",
    unitPrice: { currency: "USD", minor: "100" },
    minimumQuantity: "1",
    quantity: "10",
    termMonths: 12,
    discountBps: 0,
  };
  const inserted = await client<{ id: string }[]>`
    insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines,updated_at)
    select gen_random_uuid(), case when i <= 105 then ${owner}::uuid else ${foreign}::uuid end,
      'Owner', ${tag}, 'Example', 'USD', '2026-10-10', ${JSON.stringify([{ id: bookId, version: 1 }])}::jsonb, ${JSON.stringify([line])}::jsonb,
      case when i > 105 then '2028-01-01'::timestamptz when i % 2 = 0 then '2027-01-01T00:00:00.000901Z'::timestamptz else '2027-01-01T00:00:00.000100Z'::timestamptz end
    from generate_series(1,125) i returning id`;
  scenarioIds.push(...inserted.map(({ id }) => id));
  const expected = await client<
    { id: string }[]
  >`select id from commerce_pricing_scenarios where owner_id=${owner} order by updated_at desc,id desc`;
  const repository = new PricingScenarioRepository(db);
  const scope = { kind: "own" as const, ownerId: owner };
  expect(await repository.list(scope)).toHaveLength(100);
  const ids = await collect((cursor) =>
    repository.listPage(scope, { limit: 17, ...(cursor ? { cursor } : {}) }),
  );
  expect(ids).toEqual(expected.map(({ id }) => id));
  expect(new Set(ids).size).toBe(105);

  const unreadableId = randomUUID();
  scenarioIds.push(unreadableId);
  await client`insert into commerce_pricing_scenarios(id,owner_id,owner_name,name,company,currency,as_of,price_books,lines,updated_at)
    values(${unreadableId},${owner},'Owner',${tag},'Example','USD','2026-10-10','[{}]'::jsonb,'[{}]'::jsonb,'2029-01-01')`;
  const skipped = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const emptyPage = await repository.listPage(scope, { limit: 1 });
    expect(emptyPage.rows).toEqual([]);
    expect(emptyPage.nextCursor).toBeTypeOf("string");
    if (!emptyPage.nextCursor) throw new Error("Missing continuation cursor");
    const nextPage = await repository.listPage(scope, {
      limit: 1,
      cursor: emptyPage.nextCursor,
    });
    expect(nextPage.rows.map(({ id }) => id)).toEqual([expected[0]?.id]);
    expect(skipped).toHaveBeenCalledTimes(1);
  } finally {
    skipped.mockRestore();
  }
});

it("reads beyond the handoff UI cap and applies ownership/status before page limits", async () => {
  const contracts = await client<{ id: string }[]>`
    insert into commerce_contracts(id,counterparty_name,contract_type,paper,status,owner_name,created_by_id,created_by_name)
    select gen_random_uuid(), ${tag}, 'customer_msa','ours','executed','Owner',${owner},'Owner'
    from generate_series(1,230) returning id`;
  handoffIds.push(...contracts.map(({ id }) => id));
  await client`
    insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side,created_at)
    select id, ${owner}::uuid, 'Owner', ${tag}, 'Signer','signer@example.test',array[id],'customer',
      case when ordinal % 2 = 0 then '2027-01-01T00:00:00.000901Z'::timestamptz else '2027-01-01T00:00:00.000100Z'::timestamptz end
    from unnest(${handoffIds}::uuid[]) with ordinality as fixture(id,ordinal)`;
  await client`update commerce_handoff_requests set status='in_progress',assignee_id=${owner},assignee_name='Owner',version=version+1
    where id = any(${handoffIds.slice(205)})`;
  // A different seller's newer request must never consume the first page.
  const outsider = randomUUID();
  handoffIds.push(outsider);
  await client`insert into commerce_contracts(id,counterparty_name,contract_type,paper,status,owner_name,created_by_id,created_by_name)
    values(${outsider},${tag},'customer_msa','ours','executed','Other',${foreign},'Other')`;
  await client`insert into commerce_handoff_requests(id,requested_by_id,requested_by_name,counterparty_legal_name,signer_name,signer_email,contract_ids,requested_side,created_at)
    values(${outsider},${foreign},'Other',${tag},'Signer','signer@example.test',array[${outsider}::uuid],'customer','2028-01-01')`;
  const repository = new HandoffRequestRepository(db);
  const scope = { kind: "own" as const, userId: owner };
  expect(await repository.list(scope, "open")).toHaveLength(200);
  const expected = await client<
    { id: string }[]
  >`select id from commerce_handoff_requests where requested_by_id=${owner} and status='open' order by created_at desc,id desc`;
  const ids = await collect((cursor) =>
    repository.listPage(scope, "open", {
      limit: 19,
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(ids).toEqual(expected.map(({ id }) => id));
  expect(new Set(ids).size).toBe(205);
});

it("reads beyond the partner UI cap with query filters and full timestamp cursor precision", async () => {
  const inserted = await client<{ id: string }[]>`
    insert into commerce_partners(id,name,status,owner_id,owner_name,created_by_id,created_by_name,updated_at)
    select gen_random_uuid(), ${tag}, case when i <= 505 then 'active' else 'ended' end,
      ${owner}::uuid,'Owner',${owner}::uuid,'Owner',
      case when i > 505 then '2028-01-01'::timestamptz when i % 2 = 0 then '2027-01-01T00:00:00.000901Z'::timestamptz else '2027-01-01T00:00:00.000100Z'::timestamptz end
    from generate_series(1,530) i returning id`;
  partnerIds.push(...inserted.map(({ id }) => id));
  const repository = new PartnerRepository(db);
  const query = PartnerListQuerySchema.parse({
    q: tag,
    status: "active",
    mine: "1",
  });
  const scope = { viewerId: owner, today: "2026-10-11" };
  expect((await repository.list(query, scope)).rows).toHaveLength(500);
  const expected = await client<
    { id: string }[]
  >`select id from commerce_partners where owner_id=${owner} and status='active' order by updated_at desc,id desc`;
  const ids = await collect((cursor) =>
    repository.listPage(query, scope, {
      limit: 37,
      ...(cursor ? { cursor } : {}),
    }),
  );
  expect(ids).toEqual(expected.map(({ id }) => id));
  expect(new Set(ids).size).toBe(505);
});
