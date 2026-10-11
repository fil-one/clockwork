import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { recordHostedMfaEnrollment, recordMfaReceipt } from "./mfa";

const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
afterAll(() => client.end());

async function fixture() {
  const commerceUserId = randomUUID();
  const workosUserId = `hosted_mfa_${commerceUserId}`;
  const organizationId = "30000000-0000-4000-8000-000000000008";
  const [organization] = await client<{ workos_organization_id: string }[]>`
    select workos_organization_id from organizations where id = ${organizationId}`;
  if (!organization?.workos_organization_id)
    throw new Error("Seeded staff organization is required");
  await client`
    insert into commerce_users
      (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled, access_token_mfa_factor_id)
    values (${commerceUserId}, ${workosUserId}, ${`${commerceUserId}@clockwork.test`},
      'Hosted MFA', true, false, 'factor_preserved')`;
  await client`
    insert into memberships (user_id, organization_id, role)
    values (${commerceUserId}, ${organizationId}, 'internal_operator')`;
  return {
    commerceUserId,
    workosUserId,
    workosOrganizationId: organization.workos_organization_id,
    sessionId: `hosted_session_${commerceUserId}`,
    factorId: "factor_preserved",
  };
}

it("synchronizes enrollment exactly once across concurrent and repeated hosted sign-ins without creating challenge evidence", async () => {
  const input = await fixture();
  const outcomes = await Promise.all(
    Array.from({ length: 3 }, () => recordHostedMfaEnrollment(db, input)),
  );
  expect(outcomes).toEqual([true, true, true]);
  await recordHostedMfaEnrollment(db, {
    ...input,
    sessionId: `later_${input.sessionId}`,
  });
  const [person] = await client`
    select mfa_enrolled, row_version, access_token_mfa_factor_id
    from commerce_users where id = ${input.commerceUserId}`;
  expect(person).toEqual({
    mfa_enrolled: true,
    row_version: 2,
    access_token_mfa_factor_id: "factor_preserved",
  });
  const events = await client<{ id: string }[]>`
    select id, aggregate_type, actor, request_id, metadata, "before", "after"
    from audit_events where aggregate_id = ${input.commerceUserId}
      and event_type = 'identity.mfa_enrolled'`;
  expect(events).toHaveLength(1);
  const event = events[0];
  if (!event) throw new Error("Expected enrollment audit event");
  expect(events[0]).toMatchObject({
    aggregate_type: "user",
    actor: { kind: "user", id: input.commerceUserId },
    request_id: `hosted-mfa-enrollment:${input.sessionId}`,
    before: { mfaEnrolled: false },
    after: { mfaEnrolled: true },
    metadata: {
      source: "workos_hosted_session",
      sessionId: input.sessionId,
      workosUserId: input.workosUserId,
      workosOrganizationId: input.workosOrganizationId,
    },
  });
  const messages = await client`
    select topic from outbox_messages where event_id = ${event.id}`;
  expect(messages).toEqual([{ topic: "identity.mfa_enrolled" }]);
  const receipts = await client`
    select challenge_id from experience_mfa_receipts
    where workos_user_id = ${input.workosUserId}`;
  expect(receipts).toHaveLength(0);
});

it("allows a previously unknown factor without binding it as token evidence", async () => {
  const input = await fixture();
  await client`update commerce_users set access_token_mfa_factor_id = null
    where id = ${input.commerceUserId}`;
  await expect(recordHostedMfaEnrollment(db, input)).resolves.toBe(true);
  const [person] = await client`
    select mfa_enrolled, access_token_mfa_factor_id from commerce_users
    where id = ${input.commerceUserId}`;
  expect(person).toEqual({
    mfa_enrolled: true,
    access_token_mfa_factor_id: null,
  });
});

it.each([false, true])(
  "requires a real challenge for a changed factor when enrollment is %s",
  async (enrolled) => {
    const input = await fixture();
    if (enrolled)
      await client`update commerce_users set mfa_enrolled = true where id = ${input.commerceUserId}`;
    await expect(
      recordHostedMfaEnrollment(db, {
        ...input,
        factorId: "factor_replacement",
      }),
    ).resolves.toBe(false);
    const [person] = await client`
    select mfa_enrolled, access_token_mfa_factor_id from commerce_users
    where id = ${input.commerceUserId}`;
    expect(person).toEqual({
      mfa_enrolled: enrolled,
      access_token_mfa_factor_id: "factor_preserved",
    });
    const events = await client`
    select id from audit_events where aggregate_id = ${input.commerceUserId}
      and event_type = 'identity.mfa_enrolled'`;
    expect(events).toHaveLength(0);
    const receipts = await client`
    select challenge_id from experience_mfa_receipts where workos_user_id = ${input.workosUserId}`;
    expect(receipts).toHaveLength(0);
  },
);

it.each(["commerceUserId", "workosUserId", "workosOrganizationId"] as const)(
  "refuses a mismatched %s binding without changing enrollment or writing audit evidence",
  async (field) => {
    const input = await fixture();
    await expect(
      recordHostedMfaEnrollment(db, { ...input, [field]: randomUUID() }),
    ).rejects.toThrow("HOSTED_MFA_MEMBERSHIP_REQUIRED");
    const [person] = await client`
      select mfa_enrolled, row_version from commerce_users where id = ${input.commerceUserId}`;
    expect(person).toEqual({ mfa_enrolled: false, row_version: 1 });
    const events = await client`
      select id from audit_events where aggregate_id = ${input.commerceUserId}
        and event_type = 'identity.mfa_enrolled'`;
    expect(events).toHaveLength(0);
  },
);

it("refuses a deactivated membership", async () => {
  const input = await fixture();
  await client`delete from memberships where user_id = ${input.commerceUserId}`;
  await expect(recordHostedMfaEnrollment(db, input)).rejects.toThrow(
    "HOSTED_MFA_MEMBERSHIP_REQUIRED",
  );
  const [person] = await client`
    select mfa_enrolled from commerce_users where id = ${input.commerceUserId}`;
  expect(person?.mfa_enrolled).toBe(false);
});

it.each(["hosted", "receipt"] as const)(
  "serializes first enrollment and a real receipt with %s queued first",
  async (first) => {
    const input = await fixture();
    const key = `access_tokens:${input.commerceUserId}`;
    const waitForWaiters = (count: number) =>
      vi.waitFor(
        async () => {
          const [row] = await client<{ count: number }[]>`
          select count(*)::int as count from pg_locks
          where locktype = 'advisory' and not granted
            and classid = ((hashtextextended(${key}, 0) >> 32) & 4294967295)::oid
            and objid = (hashtextextended(${key}, 0) & 4294967295)::oid`;
          expect(row?.count).toBe(count);
        },
        { timeout: 10_000, interval: 25 },
      );
    let hosted: Promise<boolean | Error> | undefined;
    let receipt: Promise<void | Error> | undefined;
    const capture = (error: unknown) => {
      if (error instanceof Error) return error;
      throw error;
    };
    const start = (operation: typeof first) => {
      if (operation === "hosted")
        hosted = recordHostedMfaEnrollment(db, input).catch(capture);
      else
        receipt = recordMfaReceipt(db, {
          ...input,
          factorId: "factor_replacement",
          challengeId: randomUUID(),
        }).catch(capture);
    };
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      start(first);
      await waitForWaiters(1);
      start(first === "hosted" ? "receipt" : "hosted");
      await waitForWaiters(2);
    });
    const [hostedResult, receiptResult] = await Promise.all([hosted, receipt]);
    expect(hostedResult).toBe(first === "hosted");
    expect(receiptResult).toBeUndefined();
    const [person] = await client`
      select mfa_enrolled, access_token_mfa_factor_id from commerce_users
      where id = ${input.commerceUserId}`;
    expect(person).toEqual({
      mfa_enrolled: true,
      access_token_mfa_factor_id: "factor_replacement",
    });
    const events = await client`
      select id from audit_events where aggregate_id = ${input.commerceUserId}
        and event_type = 'identity.mfa_enrolled'`;
    expect(events).toHaveLength(1);
  },
  30_000,
);
