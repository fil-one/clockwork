import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";

import { PartnerListQuerySchema, addPartnerDays } from "@clockwork/contracts";

import { createRuntimeDatabase } from "../client";
import { PartnerRepository, countPartnerNextSteps } from "./partners";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

const repo = new PartnerRepository(db);
// Seeded staff (an internal operator holds the sales workspace), a customer
// user, a channel-partner organization and the Fil One organization.
const staffId = "20000000-0000-4000-8000-000000000001";
const customerUserId = "20000000-0000-4000-8000-000000000002";
const partnerOrganization = "30000000-0000-4000-8000-000000000004";
const filOneOrganization = "30000000-0000-4000-8000-000000000008";
const seller = { kind: "user" as const, id: staffId, display: "Iris Operator" };
const otherSeller = { kind: "user" as const, id: randomUUID(), display: "B" };
const tag = randomUUID().slice(0, 8);
const twinId = randomUUID();
const today = "2026-10-10";
const partners: string[] = [];
const deals: string[] = [];

afterAll(async () => {
  // Audit events are append-only and stay behind.
  await client`delete from commerce_partner_deals where id = any(${deals})`;
  await client`delete from commerce_partners where id = any(${partners})`;
  await client`delete from memberships where user_id = ${twinId}`;
  await client`delete from commerce_users where id = ${twinId}`;
  await client.end();
});

const partnerInput = (overrides: Record<string, unknown> = {}) => {
  const id = randomUUID();
  partners.push(id);
  return {
    id,
    name: `Northwind ${tag} Referral Partners`,
    website: "https://northwind.example",
    region: "DACH",
    models: ["referral", "teaming"],
    status: "talking",
    ownerId: staffId,
    contacts: [
      { name: "Ana Ruiz", email: "Ana@Northwind.example", role: "CEO" },
    ],
    nextStep: "Send term sheet",
    nextStepDue: "2026-10-08",
    terms: {
      commissionPct: "17.5",
      commissionSchedule: "12 months from first invoice",
      commissionSteps: [
        { fromMonth: 1, ratePct: "30" },
        { fromMonth: 13, ratePct: "20" },
      ],
      currency: "EUR",
      exclusivity: "none",
      nfrAllowance: "Two NFR accounts of 10 TB",
      trialPeriod: "6 to 12 months",
      trialTargets: "Three named target accounts",
      rows: [{ label: "Payment terms", value: "Net 45", notes: "" }],
    },
    ...overrides,
  };
};

const dealInput = (
  partnerId: string,
  overrides: Record<string, unknown> = {},
) => {
  const id = randomUUID();
  deals.push(id);
  return {
    id,
    partnerId,
    endClient: `Acme ${tag}, Inc.`,
    registeredOn: today,
    estimatedSize: "250",
    sizeUnit: "TB",
    model: "referral",
    ...overrides,
  };
};

const auditTypes = async (type: string, id: string) =>
  (
    await client<{ event_type: string }[]>`
      select event_type from audit_events
      where aggregate_type = ${type} and aggregate_id = ${id}
      order by aggregate_version`
  ).map((row) => row.event_type);

describe("PartnerRepository", () => {
  it("records a partner with terms once, then edits it and audits each change", async () => {
    const raw = partnerInput();
    const created = await repo.save(raw, seller);
    expect(created).toMatchObject({
      status: "talking",
      ownerName: "Iris Operator",
      models: ["referral", "teaming"],
      contacts: [{ email: "ana@northwind.example" }],
      terms: {
        commissionPct: "17.5",
        currency: "EUR",
        commissionSteps: [
          { fromMonth: 1, ratePct: "30" },
          { fromMonth: 13, ratePct: "20" },
        ],
      },
      version: 1,
    });
    // A retried first save returns what was stored.
    await expect(repo.save(raw, seller)).resolves.toMatchObject({
      id: created.id,
      version: 1,
    });
    await expect(repo.save(raw, otherSeller)).rejects.toThrow(
      "PARTNER_IDEMPOTENCY_CONFLICT",
    );
    // The first answer was lost and the seller changed the form before
    // sending again: refused, not silently dropped.
    await expect(
      repo.save({ ...raw, nextStep: "Call them on Monday" }, seller),
    ).rejects.toThrow("PARTNER_IDEMPOTENCY_CONFLICT");
    // The same rate typed another way is the same record.
    await expect(
      repo.save(
        { ...raw, terms: { ...raw.terms, commissionPct: "017.50" } },
        seller,
      ),
    ).resolves.toMatchObject({ id: created.id, version: 1 });

    const edited = await repo.save(
      {
        ...raw,
        expectedVersion: 1,
        status: "terms_agreed",
        terms: { ...raw.terms, commissionPct: "20" },
      },
      otherSeller,
    );
    expect(edited).toMatchObject({ status: "terms_agreed", version: 2 });
    // Another staff member with the same display name is still a new owner.
    await client`insert into commerce_users (id, workos_user_id, email, name, is_internal_staff)
      values (${twinId}, ${`twin-${tag}`}, ${`twin-${tag}@clockwork.test`}, 'Iris Operator', true)`;
    await client`insert into memberships (organization_id, user_id, role)
      values (${filOneOrganization}, ${twinId}, 'revenue')`;
    expect(edited.terms.commissionPct).toBe("20");
    await expect(
      repo.save({ ...raw, expectedVersion: 1 }, seller),
    ).rejects.toThrow("PARTNER_VERSION_CONFLICT");
    // Saving the form again unchanged records nothing new.
    await expect(
      repo.save(
        {
          ...raw,
          expectedVersion: 2,
          status: "terms_agreed",
          terms: { ...raw.terms, commissionPct: "20.00" },
        },
        seller,
      ),
    ).resolves.toMatchObject({ version: 2 });
    expect(await auditTypes("partner", created.id)).toEqual([
      "partner.created",
      "partner.updated",
    ]);

    const reassigned = await repo.save(
      {
        ...raw,
        expectedVersion: 2,
        status: "terms_agreed",
        terms: { ...raw.terms, commissionPct: "20" },
        ownerId: twinId,
      },
      seller,
    );
    expect(reassigned).toMatchObject({ ownerId: twinId, version: 3 });
    const [ownerChange] = await client<{ changes: Record<string, unknown> }[]>`
      select after->'changes' as changes from audit_events
      where aggregate_type = 'partner' and aggregate_id = ${created.id}
        and aggregate_version = 3`;
    expect(ownerChange?.changes).toEqual({
      ownerId: { from: staffId, to: twinId },
    });
    const detail = await repo.get(created.id, today);
    expect(detail.activity[1]).toMatchObject({
      eventType: "partner.updated",
      actorName: "B",
      changes: {
        status: { from: "talking", to: "terms_agreed" },
        commissionPct: { from: "17.5", to: "20" },
      },
    });
  });

  it("accepts any rate from 0 to 100 and refuses values outside it", async () => {
    await expect(
      repo.save(partnerInput({ terms: { commissionPct: "32.125" } }), seller),
    ).resolves.toMatchObject({ terms: { commissionPct: "32.125" } });
    expect(() =>
      repo.save(partnerInput({ terms: { commissionPct: "100.5" } }), seller),
    ).toThrow("percent_range");
  });

  it("assigns only staff with the sales workspace and links only customer or partner organizations", async () => {
    await expect(
      repo.save(partnerInput({ ownerId: customerUserId }), seller),
    ).rejects.toThrow("PARTNER_OWNER_NOT_STAFF");
    await expect(
      repo.save(partnerInput({ organizationId: filOneOrganization }), seller),
    ).rejects.toThrow("PARTNER_ORGANIZATION_NOT_FOUND");
    const linked = await repo.save(
      partnerInput({ organizationId: partnerOrganization, ownerId: null }),
      seller,
    );
    expect(linked).toMatchObject({ ownerId: null, ownerName: null });
    const detail = await repo.get(linked.id, today);
    expect(detail.partner.organizationId).toBe(partnerOrganization);
    expect(detail.partner.organizationName).toBeTruthy();
    // An owner who later leaves the sales workspace does not block edits.
    const kept = await repo.save(partnerInput(), seller);
    await client`update commerce_partners
      set owner_id = ${customerUserId}, owner_name = 'Former Seller', version = 2
      where id = ${kept.id}`;
    await expect(
      repo.save(
        {
          ...partnerInput(),
          id: kept.id,
          ownerId: customerUserId,
          expectedVersion: 2,
          region: "Nordics",
        },
        seller,
      ),
    ).resolves.toMatchObject({ ownerName: "Former Seller", region: "Nordics" });
    expect((await repo.owners()).map(({ id }) => id)).toContain(staffId);
    expect((await repo.organizations()).map(({ id }) => id)).toContain(
      partnerOrganization,
    );
  });

  it("registers deals with policy protection and warns, never blocks, on another partner's open registration", async () => {
    const first = await repo.save(partnerInput(), seller);
    const second = await repo.save(
      partnerInput({ name: `Southwind ${tag} Resale` }),
      seller,
    );
    const days = await repo.protectionDays();
    const firstDeal = dealInput(first.id);
    const registered = await repo.saveDeal(firstDeal, seller, today);
    // A resend after a lost answer: the same deal returns, an edited one is
    // refused.
    await expect(
      repo.saveDeal(firstDeal, seller, today),
    ).resolves.toMatchObject({ deal: { id: registered.deal.id, version: 1 } });
    await expect(
      repo.saveDeal({ ...firstDeal, notes: "Changed my mind" }, seller, today),
    ).rejects.toThrow("PARTNER_DEAL_IDEMPOTENCY_CONFLICT");
    expect(registered.deal).toMatchObject({
      status: "registered",
      protectedUntil: addPartnerDays(today, days),
      estimatedSize: "250",
      sizeUnit: "TB",
    });
    expect(registered.conflicts).toEqual([]);

    // The same company typed differently is the same end client.
    const overlapping = await repo.saveDeal(
      dealInput(second.id, {
        endClient: `ACME ${tag} Inc`,
        protectedUntil: "2026-12-31",
      }),
      seller,
      today,
    );
    expect(overlapping.deal.protectedUntil).toBe("2026-12-31");
    expect(overlapping.conflicts).toEqual([
      expect.objectContaining({
        dealId: registered.deal.id,
        partnerId: first.id,
      }),
    ]);
    expect(
      await repo.dealConflicts(`acme ${tag}`, {
        excludePartnerId: first.id,
        today,
      }),
    ).toEqual([expect.objectContaining({ partnerId: second.id })]);

    const detail = await repo.get(first.id, today);
    expect(detail.deals[0]?.conflicts).toEqual([
      expect.objectContaining({ partnerId: second.id }),
    ]);

    // Withdrawing the second registration clears the warning on the first.
    const withdrawn = await repo.saveDeal(
      {
        ...dealInput(second.id),
        id: overlapping.deal.id,
        endClient: overlapping.deal.endClient,
        protectedUntil: overlapping.deal.protectedUntil,
        status: "withdrawn",
        expectedVersion: 1,
      },
      seller,
      today,
    );
    expect(withdrawn.deal).toMatchObject({ status: "withdrawn", version: 2 });
    expect((await repo.get(first.id, today)).deals[0]?.conflicts).toEqual([]);
    await expect(
      repo.saveDeal(
        { ...dealInput(first.id), id: overlapping.deal.id, expectedVersion: 2 },
        seller,
        today,
      ),
    ).rejects.toThrow("PARTNER_DEAL_PARTNER_MISMATCH");
    expect(await auditTypes("partner_deal", overlapping.deal.id)).toEqual([
      "partner.deal_registered",
      "partner.deal_updated",
    ]);
  });

  it("marks a registration expired on read once its protection ends", async () => {
    const partner = await repo.save(partnerInput(), seller);
    const { deal } = await repo.saveDeal(
      dealInput(partner.id, {
        endClient: `Lapsed ${tag} GmbH`,
        registeredOn: "2026-06-01",
        protectedUntil: "2026-09-01",
      }),
      seller,
      today,
    );
    expect(deal.status).toBe("registered");
    const detail = await repo.get(partner.id, today);
    expect(detail.deals.find(({ id }) => id === deal.id)).toMatchObject({
      status: "expired",
      version: 2,
    });
    expect(await auditTypes("partner_deal", deal.id)).toEqual([
      "partner.deal_registered",
      "partner.deal_expired",
    ]);
    expect(detail.activity[0]).toMatchObject({
      eventType: "partner.deal_expired",
      actorName: "Commerce",
      dealEndClient: `Lapsed ${tag} GmbH`,
    });
  });

  it("filters the list, exports the same rows and counts next steps due", async () => {
    const mine = await repo.save(
      partnerInput({
        name: `Filter ${tag} Mine`,
        models: ["affiliate"],
        status: "active",
        nextStepDue: "2026-10-09",
      }),
      seller,
    );
    const theirs = await repo.save(
      partnerInput({
        name: `Filter ${tag} Unowned`,
        ownerId: null,
        models: ["resale"],
        status: "negotiating",
        nextStepDue: "2026-10-15",
      }),
      seller,
    );
    const query = (raw: Record<string, string>) =>
      PartnerListQuerySchema.parse({ q: `Filter ${tag}`, ...raw });
    const scope = { viewerId: staffId, today };
    const ids = async (raw: Record<string, string>) =>
      (await repo.list(query(raw), scope)).rows.map(({ id }) => id).sort();
    expect(await ids({})).toEqual([mine.id, theirs.id].sort());
    expect(await ids({ mine: "1" })).toEqual([mine.id]);
    expect(await ids({ status: "negotiating" })).toEqual([theirs.id]);
    expect(await ids({ model: "affiliate" })).toEqual([mine.id]);
    expect(await ids({ due: "overdue" })).toEqual([mine.id]);
    expect(await ids({ due: "week" })).toEqual([mine.id, theirs.id].sort());
    // Contacts match on their values, not the JSON key names.
    expect(
      (
        await repo.list(PartnerListQuerySchema.parse({ q: "email" }), scope)
      ).rows
        .map(({ id }) => id)
        .filter((id) => [mine.id, theirs.id].includes(id)),
    ).toEqual([]);
    expect(
      (
        await repo.list(PartnerListQuerySchema.parse({ q: "ana ruiz" }), scope)
      ).rows.map(({ id }) => id),
    ).toEqual(expect.arrayContaining([mine.id, theirs.id]));
    const exported = await repo.exportRows(query({}), scope);
    expect(exported.rows.map(({ id }) => id).sort()).toEqual(
      [mine.id, theirs.id].sort(),
    );
    expect(exported.rows[0]?.terms?.currency).toBe("EUR");

    const due = await repo.nextStepsDue({
      through: addPartnerDays(today, 7),
      today,
      ownerId: staffId,
    });
    expect(due.find(({ partnerId }) => partnerId === mine.id)).toMatchObject({
      overdue: true,
      nextStep: "Send term sheet",
    });
    expect(due.some(({ partnerId }) => partnerId === theirs.id)).toBe(false);

    const counts = await countPartnerNextSteps(db, scope);
    expect(counts.overdue.mine).toBeGreaterThanOrEqual(1);
    expect(counts.dueThisWeek.team).toBeGreaterThanOrEqual(
      counts.dueThisWeek.mine + 1,
    );

    await repo.recordExport(seller, {
      filters: query({}),
      rows: exported.rows.length,
      truncated: false,
    });
  });
});
