import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { HandoffRequestRepository } from "../system/handoff-requests";
import { OrganizationOnboardingRepository } from "./organization-onboarding";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

const onboarding = new OrganizationOnboardingRepository(db);
const handoffs = new HandoffRequestRepository(db);
const seller = { kind: "user" as const, id: randomUUID(), display: "Seller" };
const operator = { kind: "user" as const, id: randomUUID(), display: "Ops" };
const suffix = randomUUID().slice(0, 8);
const contract = randomUUID();
const handoffIds: string[] = [];

beforeAll(async () => {
  await client`insert into commerce_contracts
    (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name)
    values (${contract}, ${`Onboarding ${suffix}`}, 'channel_partnership', 'ours', 'executed',
      'Seller', ${seller.id}, 'Seller')`;
});

afterAll(async () => {
  await client`delete from commerce_handoff_requests where id = any(${handoffIds})`;
  await client`delete from commerce_contracts where id = ${contract}`;
  await client.end();
});

const input = (patch: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  legalName: `Onboarding ${suffix} Ltd`,
  side: "customer",
  country: "GB",
  currency: "GBP",
  domain: `onboarding-${suffix}.test`,
  registeredAddress: {
    line1: "1 Archive Way",
    city: "London",
    postalCode: "EC1A 1AA",
  },
  billingContact: { name: "Ada Buyer", email: `ADA@onboarding-${suffix}.test` },
  invoiceDeliveryEmail: `invoices@onboarding-${suffix}.test`,
  ...patch,
});

const events = async (aggregateId: string) =>
  client<{ event_type: string; actor: { id: string }; topic: string }[]>`
    select e.event_type, e.actor, m.topic from audit_events e
    join outbox_messages m on m.event_id = e.id
    where e.aggregate_id = ${aggregateId} order by e.aggregate_version`;

describe("OrganizationOnboardingRepository", () => {
  it("creates a customer once and starts its identity provider organization", async () => {
    const raw = input();
    const created = await onboarding.create(raw, operator);
    expect(created).toMatchObject({
      organizationId: raw.id,
      side: "customer",
      legalName: raw.legalName,
    });
    await expect(onboarding.create(raw, operator)).resolves.toEqual(created);
    const [account] = await client<
      {
        relationship_roles: string[];
        partner_agreement_type: string | null;
        screening_status: string;
        billing_contact: { email: string };
        registered_address: { country: string };
      }[]
    >`select relationship_roles, partner_agreement_type, screening_status, billing_contact,
        registered_address from accounts where id = ${created.accountId}`;
    expect(account).toMatchObject({
      relationship_roles: ["direct_client"],
      partner_agreement_type: null,
      screening_status: "review",
      billing_contact: { email: `ada@onboarding-${suffix}.test` },
      registered_address: { country: "GB" },
    });
    const [profile] = await client`select 1 from procurement_profiles
      where account_id = ${created.accountId}`;
    expect(profile).toBeDefined();
    expect(await events(created.organizationId)).toEqual([
      {
        event_type: "organization.created",
        actor: expect.objectContaining({ id: operator.id }) as unknown,
        topic: "organization.created",
      },
    ]);
    const detail = await onboarding.get(created.organizationId);
    expect(detail).toMatchObject({
      side: "customer",
      identityProviderLinked: false,
      members: [],
      handoffRequestIds: [],
    });
    expect(
      (await onboarding.list()).map(({ organizationId }) => organizationId),
    ).toContain(created.organizationId);
  });

  it("creates a partner from a handoff it is working and records it there", async () => {
    const request = await handoffs.create(
      {
        id: randomUUID(),
        contractIds: [contract],
        counterpartyLegalName: `Onboarding ${suffix} Partner`,
        signerName: "Sam Roe",
        signerEmail: "sam@partner.test",
        requestedSide: "partner",
      },
      seller,
    );
    handoffIds.push(request.id);
    const raw = input({
      side: "referral_partner",
      legalName: `Onboarding ${suffix} Partner`,
      domain: `partner-${suffix}.test`,
      handoffRequestId: request.id,
    });
    await expect(onboarding.create(raw, operator)).rejects.toThrow(
      "ONBOARDING_HANDOFF_NOT_IN_PROGRESS",
    );
    await handoffs.take({ id: request.id, expectedVersion: 1 }, operator);
    await expect(
      onboarding.create({ ...raw, side: "customer" }, operator),
    ).rejects.toThrow("ONBOARDING_HANDOFF_SIDE_MISMATCH");
    const created = await onboarding.create(raw, operator);
    expect(created.side).toBe("referral_partner");
    const [account] = await client<
      { relationship_roles: string[]; partner_agreement_type: string }[]
    >`select relationship_roles, partner_agreement_type from accounts
      where id = ${created.accountId}`;
    expect(account).toEqual({
      relationship_roles: ["partner"],
      partner_agreement_type: "referral",
    });
    const recorded = await handoffs.get(request.id, { kind: "all" });
    expect(recorded).toMatchObject({
      organizationId: created.organizationId,
      status: "in_progress",
      version: 3,
    });
    await expect(
      onboarding.create({ ...raw, id: randomUUID() }, operator),
    ).rejects.toThrow("ONBOARDING_HANDOFF_ALREADY_HAS_ORGANIZATION");
    await expect(onboarding.create(raw, operator)).resolves.toMatchObject({
      organizationId: created.organizationId,
    });
    expect((await events(request.id)).map((row) => row.event_type)).toEqual([
      "handoff.requested",
      "handoff.taken",
      "handoff.organization_recorded",
    ]);
    expect(
      (await onboarding.get(created.organizationId)).handoffRequestIds,
    ).toEqual([request.id]);
  });

  it("gives a channel partner the agreement type operations chose", async () => {
    await expect(
      onboarding.create(
        input({ legalName: `Onboarding ${suffix} Reseller` }),
        operator,
      ),
    ).rejects.toThrow("ONBOARDING_DOMAIN_TAKEN");
    await expect(
      onboarding.create(input({ domain: `other-${suffix}.test` }), operator),
    ).rejects.toThrow("ONBOARDING_ACCOUNT_EXISTS");
    const created = await onboarding.create(
      input({
        side: "channel_partner",
        channelAgreementType: "msp",
        legalName: `Onboarding ${suffix} Reseller`,
        domain: `reseller-${suffix}.test`,
      }),
      operator,
    );
    const [row] = await client<
      { side: string; partner_agreement_type: string }[]
    >`select o.side, a.partner_agreement_type from organizations o
      join accounts a on a.id = o.account_id where o.id = ${created.organizationId}`;
    expect(row).toEqual({
      side: "channel_partner",
      partner_agreement_type: "msp",
    });
  });

  it("never reads Fil One's own organization as a customer or partner", async () => {
    const [staff] = await client<{ id: string }[]>`
      select id from organizations where side = 'fil_one' limit 1`;
    if (staff)
      await expect(onboarding.get(staff.id)).rejects.toThrow(
        "ONBOARDING_ORGANIZATION_NOT_FOUND",
      );
  });

  it("compares legal names as registration does", async () => {
    const tag = randomUUID().slice(0, 6).replace(/\d/gu, "x");
    await onboarding.create(
      input({
        legalName: `Acme ${tag}, Inc.`,
        country: "DE",
        domain: `acme-${tag}-${suffix}.test`,
      }),
      operator,
    );
    await expect(
      onboarding.create(
        input({
          legalName: `ACME ${tag.toUpperCase()} Inc`,
          country: "DE",
          domain: `acme-other-${tag}-${suffix}.test`,
        }),
        operator,
      ),
    ).rejects.toThrow("ONBOARDING_ACCOUNT_EXISTS");
    // The same name in another country is another legal entity.
    await expect(
      onboarding.create(
        input({
          legalName: `ACME ${tag.toUpperCase()} Inc`,
          country: "FR",
          domain: `acme-fr-${tag}-${suffix}.test`,
        }),
        operator,
      ),
    ).resolves.toMatchObject({ side: "customer" });
  });
});
