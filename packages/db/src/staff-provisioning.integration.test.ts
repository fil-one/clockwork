import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { provisionStaff } from "../../../scripts/provision-staff";
import { createRuntimeDatabase } from "./client";
import { accounts, organizations } from "./schema";

const url =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { db, client } = createRuntimeDatabase({
  url,
  role: "clockwork_service",
  ssl: false,
});
const accountId = randomUUID();
const organizationId = randomUUID();
const workosOrganizationId = `org_${organizationId.replaceAll("-", "")}`;
const operatorId = randomUUID();
const historicalOrganizationEventId = randomUUID();
const identities: string[] = [operatorId];
const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
// Even an accidentally unmocked provider must never leave the local test.
const fetchSpy = vi
  .spyOn(globalThis, "fetch")
  .mockRejectedValue(new Error("Unexpected provider call"));

async function audit(
  id: string,
  aggregateType: string,
  aggregateId: string,
  version: number,
) {
  await client`insert into audit_events(id,aggregate_type,aggregate_id,aggregate_version,event_type,event_version,actor,occurred_at,request_id,after)
    values(${id},${aggregateType},${aggregateId},${version},'test.staff.history',1,${JSON.stringify({ kind: "user", id: operatorId })}::jsonb,now(),${randomUUID()},'{}'::jsonb)`;
}

beforeAll(async () => {
  await db.insert(accounts).values({
    id: accountId,
    legalName: `Provisioning ${accountId}`,
    relationshipRoles: ["direct_client"],
    registeredAddress: {
      line1: "1 Main St",
      city: "Wilmington",
      region: "DE",
      postalCode: "19801",
      country: "US",
    },
    billingContact: { name: "Billing", email: "billing@fil.one" },
    apContact: { name: "AP", email: "ap@fil.one" },
    invoiceDeliveryEmail: "billing@fil.one",
    domain: `provisioning-${accountId}.test`,
    country: "US",
    currency: "USD",
  } as typeof accounts.$inferInsert);
  await db.insert(organizations).values({
    id: organizationId,
    accountId,
    name: "Provisioning audit",
    side: "fil_one",
    workosOrganizationId,
  } as typeof organizations.$inferInsert);
  await client`insert into commerce_users(id,workos_user_id,email,name,is_internal_staff,mfa_enrolled)
    values(${operatorId},${`user_${operatorId}`},${`operator-${operatorId}@fil.one`},'Provisioning operator',true,true)`;
  await client`insert into memberships(id,organization_id,user_id,role)
    values(${randomUUID()},${organizationId},${operatorId},'commerce_admin')`;
  await audit(historicalOrganizationEventId, "organization", organizationId, 1);
});

afterAll(async () => {
  consoleLog.mockRestore();
  fetchSpy.mockRestore();
  await client`delete from memberships where organization_id=${organizationId}`;
  // Retain identities referenced by immutable audit/notices, but remove staff eligibility.
  await client`update commerce_users set is_internal_staff=false where id=any(${identities})`;
  await client.end();
});

async function fixture(kind: "create" | "restore" | "update") {
  const id = randomUUID();
  const email = `provision-${id}@fil.one`;
  const workosUserId = `user_${id.replaceAll("-", "")}`;
  identities.push(id);
  if (kind !== "create") {
    await client`insert into commerce_users(id,workos_user_id,email,name,is_internal_staff,mfa_enrolled)
      values(${id},${workosUserId},${email},'Existing staff',true,true)`;
  }
  const priorMembershipId = randomUUID();
  if (kind !== "create") {
    await client`insert into memberships(id,organization_id,user_id,role)
      values(${priorMembershipId},${organizationId},${id},'internal_operator')`;
    await audit(randomUUID(), "membership", priorMembershipId, 1);
    if (kind === "restore")
      await client`delete from memberships where id=${priorMembershipId}`;
  }
  const environment = {
    STAFF_PROVISIONING: JSON.stringify({
      email,
      name: "Approved staff",
      title: "Staff",
      role: "commerce_admin",
      updateRole: true,
    }),
    BOOTSTRAP_MANIFEST: JSON.stringify({
      environment: "staging",
      targetDatabaseHost: new URL(url).hostname,
      operatorUserId: operatorId,
      organization: { id: organizationId, workosOrganizationId },
    }),
    DIRECT_DATABASE_URL: url,
    WORKOS_API_KEY: "test-provider-key",
    DEPLOY_STAGE: "staging",
    INTERNAL_EMAIL_DOMAINS: "fil.one",
  };
  const provider = vi.fn(() =>
    Promise.resolve({
      workosUserId,
      workosMembershipId: `om_${id.replaceAll("-", "")}`,
      outcome: "existing" as const,
    }),
  );
  return { id, email, priorMembershipId, environment, provider };
}

async function membership(email: string) {
  const [row] = await client<
    { id: string; user_id: string; role: string; row_version: number }[]
  >`
    select m.id,m.user_id,m.role,m.row_version from memberships m join commerce_users u on u.id=m.user_id where u.email=${email}`;
  if (!row) throw new Error("Expected provisioned membership");
  return row;
}

it("updates the membership audit stream past existing organization and membership history", async () => {
  const input = await fixture("update");
  await provisionStaff(input.environment, input.provider);
  expect(await membership(input.email)).toMatchObject({
    id: input.priorMembershipId,
    role: "commerce_admin",
    row_version: 2,
  });
  input.environment.STAFF_PROVISIONING = JSON.stringify({
    email: input.email,
    name: "Approved staff",
    title: "Staff",
    role: "revenue",
    updateRole: true,
  });
  await provisionStaff(input.environment, input.provider);
  expect(await membership(input.email)).toMatchObject({
    id: input.priorMembershipId,
    role: "revenue",
    row_version: 3,
  });
  // Reapplying the same approved request verifies without another mutation/audit.
  await provisionStaff(input.environment, input.provider);
  const events = await client<
    {
      aggregate_version: number;
      event_type: string;
      after: Record<string, unknown>;
      outbox_count: number;
    }[]
  >`
    select e.aggregate_version,e.event_type,e.after,(select count(*)::int from outbox_messages o where o.event_id=e.id) as outbox_count
    from audit_events e where e.aggregate_type='membership' and e.aggregate_id=${input.priorMembershipId} order by e.aggregate_version`;
  expect(events.map((event) => event.aggregate_version)).toEqual([1, 2, 3]);
  expect(events.slice(1)).toMatchObject(
    [2, 3].map((version) => ({
      aggregate_version: version,
      event_type: "staff.role_changed",
      after: { organizationId },
      outbox_count: 1,
    })),
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(input.provider).toHaveBeenCalledTimes(3);
});

it.each(["create", "restore"] as const)(
  "%s uses a fresh membership stream despite existing organization history",
  async (kind) => {
    const input = await fixture(kind);
    await provisionStaff(input.environment, input.provider);
    const row = await membership(input.email);
    identities.push(row.user_id);
    expect(row).toMatchObject({ role: "commerce_admin", row_version: 1 });
    expect(row.id).not.toBe(input.priorMembershipId);
    const events = await client<
      {
        aggregate_version: number;
        event_type: string;
        after: Record<string, unknown>;
        outbox_count: number;
      }[]
    >`
    select e.aggregate_version,e.event_type,e.after,(select count(*)::int from outbox_messages o where o.event_id=e.id) as outbox_count
    from audit_events e where e.aggregate_type='membership' and e.aggregate_id=${row.id}`;
    expect(events).toMatchObject([
      {
        aggregate_version: 1,
        event_type:
          kind === "create" ? "staff.provisioned" : "staff.reactivated",
        after: { organizationId },
        outbox_count: 1,
      },
    ]);
    const prior = await client<
      { id: string }[]
    >`select id from audit_events where aggregate_type='organization' and aggregate_id=${organizationId} and aggregate_version=1`;
    expect(prior.map(({ id }) => id)).toEqual([historicalOrganizationEventId]);
    expect(fetchSpy).not.toHaveBeenCalled();
  },
);
