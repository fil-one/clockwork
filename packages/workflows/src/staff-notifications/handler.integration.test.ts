import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { staffNotificationKindList, type Actor } from "@clockwork/contracts";
import {
  appendAuditAndOutbox,
  commerceUsers,
  createRuntimeDatabase,
  memberships,
  StaffNotificationRepository,
  StaffNotificationStore,
  withInternalTransaction,
} from "@clockwork/db";
import {
  FakeStaffEmail,
  FakeStaffSlack,
  type StaffNotificationChannels,
} from "@clockwork/integrations";

import {
  handleStaffNotificationEvent,
  retryStaffNotificationDeliveries,
  staffNotificationMaxAttempts,
} from "./handler";

/**
 * The path from a committed change to what staff are told: the audit event
 * and its outbox message are appended as the repositories append them, the
 * handler reads the message's payload, writes notifications and delivers
 * them through fake email and Slack ports. Replays, retries, preferences and
 * permissions are checked against the real tables.
 */

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
  maxConnections: 4,
});

const staffOrganization = "30000000-0000-4000-8000-000000000008";
const seller = randomUUID(); // revenue: sends MNDAs, prepares contracts
const legal = randomUUID(); // legal approver: approves contracts
const admin = randomUUID(); // commerce administrator, Fil One countersigner
const operator = randomUUID(); // internal operator: works handoffs
const departed = randomUUID(); // staff whose membership was removed
const run = randomUUID().slice(0, 8);
const email = (id: string) => `${id}@fil-one-notify.test`;
const company = `Notify ${run}, Inc.`;
const store = new StaffNotificationStore(db);
const repository = new StaffNotificationRepository(db);
const mndaIds: string[] = [];
const contractIds: string[] = [];
const system: Actor = { kind: "system", id: "esign-reconciliation" };
let settingsVersion = 1;

function channels(
  emailPort: FakeStaffEmail,
  slackPort: FakeStaffSlack,
): () => StaffNotificationChannels {
  return () => ({
    email: { configured: true, port: emailPort, target: "notify@test" },
    slack: { configured: true, port: slackPort, target: "hooks.slack.com" },
  });
}

async function setSettings(patch: Record<string, unknown>) {
  const current = await repository.settings();
  const saved = await repository.saveSettings(
    {
      emailEnabled: current.emailEnabled,
      slackEnabled: current.slackEnabled,
      emailDisabledKinds: current.emailDisabledKinds,
      slackKinds: current.slackKinds,
      slackChannelLabel: current.slackChannelLabel,
      ...patch,
    },
    current.version,
    { kind: "user", id: admin, display: "Admin" },
  );
  settingsVersion = saved.version;
}

/** Appends the event as a repository would and returns its outbox payload. */
async function emit(input: {
  aggregateId: string;
  eventType: string;
  actor?: Actor;
  occurredAt?: Date;
  after?: Record<string, unknown>;
}) {
  const { event } = await withInternalTransaction(db, randomUUID(), (tx) =>
    appendAuditAndOutbox(tx, {
      aggregateType: "agreement",
      aggregateId: input.aggregateId,
      aggregateVersion: Math.floor(Math.random() * 1_000_000) + 10,
      eventType: input.eventType,
      actor: input.actor ?? system,
      requestId: randomUUID(),
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      after: input.after ?? {},
    }),
  );
  const [message] = await client<{ payload: unknown }[]>`
    select payload from outbox_messages where event_id = ${event.id}`;
  return { eventId: event.id, payload: message?.payload };
}

async function mnda() {
  const id = randomUUID();
  mndaIds.push(id);
  await client`insert into commerce_mnda_requests
    (id, input, countersigner, owner_id, owner_name, state, template_hash, test_mode)
    values (${id}, ${JSON.stringify({ company, signerName: "Pat Lee" })}::jsonb,
      ${JSON.stringify({ id: randomUUID(), name: "Admin", email: email(admin), title: "CFO" })}::jsonb,
      ${seller}, 'Seller', 'sent', ${"a".repeat(64)}, true)`;
  return id;
}

async function contract(preparer: string) {
  const id = randomUUID();
  contractIds.push(id);
  await client`insert into commerce_contracts
    (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name)
    values (${id}, ${company}, 'order_form', 'ours', 'draft', 'Seller', ${preparer}, 'Preparer')`;
  await client`insert into commerce_contract_signing
    (contract_id, template_id, template_version, template_hash, document_name, input,
     counterparty_signer, countersigner, preparer_id, preparer_name, approval_required,
     approval_state, test_mode)
    values (${id}, 'order-form', '1', ${"b".repeat(64)}, 'Order form', '{}'::jsonb,
      ${JSON.stringify({ name: "Pat", email: "pat@acme.test", title: "" })}::jsonb,
      ${JSON.stringify({ id: randomUUID(), name: "Admin", email: email(admin), title: "CFO" })}::jsonb,
      ${preparer}, 'Preparer', true, 'pending', true)`;
  return id;
}

const notified = async (eventId: string) =>
  (
    await client<{ recipient: string }[]>`
      select recipient_user_id::text as recipient from commerce_staff_notifications
      where event_id = ${eventId} order by recipient_user_id`
  ).map((row) => row.recipient);

const deliveries = (eventId: string) =>
  client<
    {
      channel: string;
      recipient: string | null;
      status: string;
      reason: string | null;
      attempts: number;
      code: string | null;
    }[]
  >`
    select channel, recipient_user_id::text as recipient, status, reason, attempts,
      provider_code as code
    from commerce_staff_notification_deliveries
    where event_id = ${eventId} order by channel, recipient_user_id`;

beforeAll(async () => {
  await withInternalTransaction(db, `notify-fixture-${run}`, async (tx) => {
    for (const [id, role, name] of [
      [seller, "revenue", "Sam Seller"],
      [legal, "legal_approver", "Lee Legal"],
      [admin, "commerce_admin", "Ada Admin"],
      [operator, "internal_operator", "Oli Operator"],
      [departed, null, "Dana Departed"],
    ] as const) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `user_notify_${id}`,
        email: email(id),
        name,
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      if (role)
        await tx
          .insert(memberships)
          .values({ userId: id, organizationId: staffOrganization, role });
    }
  });
  const current = await repository.settings();
  settingsVersion = current.version;
});

afterAll(async () => {
  // The settings row is shared; put the defaults back for other suites.
  const current = await repository.settings();
  await repository.saveSettings(
    {
      emailEnabled: false,
      slackEnabled: false,
      emailDisabledKinds: [],
      slackKinds: [
        "contract.approval_requested",
        "contract.executed",
        "handoff.requested",
        "mnda.completed",
      ],
      slackChannelLabel: "",
    },
    current.version,
    { kind: "user", id: admin, display: "Admin" },
  );
  await client.end();
});

describe("staff notifications from audit events", () => {
  it("notifies the sender and the countersigner when the partner signs, and nobody else", async () => {
    await setSettings({ emailEnabled: false, slackEnabled: false });
    const emailPort = new FakeStaffEmail();
    const slackPort = new FakeStaffSlack();
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.awaiting_countersignature",
    });
    const result = await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(emailPort, slackPort),
      origin: "https://commerce.fil.one",
    });
    expect(result.status).toBe("notified");
    expect(await notified(eventId)).toEqual([seller, admin].sort());
    // Email and Slack are off in settings: recorded as skipped, nothing sent.
    expect(emailPort.sent).toHaveLength(0);
    expect(slackPort.posted).toHaveLength(0);
    const rows = await deliveries(eventId);
    expect(rows.every((row) => row.status === "skipped")).toBe(true);
    expect(new Set(rows.map((row) => row.reason))).toEqual(
      new Set(["channel_off"]),
    );
  });

  it("emails each recipient once and posts to Slack once, however often the event is replayed", async () => {
    await setSettings({ emailEnabled: true, slackEnabled: true });
    const emailPort = new FakeStaffEmail();
    const slackPort = new FakeStaffSlack();
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.completed",
    });
    const options = {
      store,
      channels: channels(emailPort, slackPort),
      origin: "https://commerce.fil.one",
    };
    await handleStaffNotificationEvent(payload, options);
    await handleStaffNotificationEvent(payload, options);
    await handleStaffNotificationEvent(payload, options);
    expect(await notified(eventId)).toEqual([seller]);
    expect(emailPort.sent.map((m) => m.to)).toEqual([email(seller)]);
    expect(emailPort.sent[0]?.subject).toContain(company);
    expect(emailPort.sent[0]?.text).toContain(
      "https://commerce.fil.one/internal/mndas?q=",
    );
    expect(slackPort.posted).toHaveLength(1);
    expect(slackPort.posted[0]?.text).toContain("MNDA fully signed");
  });

  it("never fails the outbox message, and the retry task resends only what the provider could not take", async () => {
    await setSettings({ emailEnabled: true, slackEnabled: false });
    const emailPort = new FakeStaffEmail();
    const slackPort = new FakeStaffSlack();
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.awaiting_countersignature",
    });
    const options = {
      store,
      channels: channels(emailPort, slackPort),
      origin: null,
    };
    // The first of the two emails fails as a provider outage. The handler
    // records it and returns: the outbox message is done.
    emailPort.failNext("transient");
    await expect(
      handleStaffNotificationEvent(payload, options),
    ).resolves.toMatchObject({ status: "notified", sent: 1, failed: 1 });
    expect(emailPort.sent).toHaveLength(1);
    const [failed] = (await deliveries(eventId)).filter(
      (r) => r.status === "failed",
    );
    expect(failed).toMatchObject({
      reason: "provider_unavailable",
      code: "FAKE_EMAIL",
    });
    // A redelivered outbox message sends nothing again.
    await handleStaffNotificationEvent(payload, options);
    expect(emailPort.sent).toHaveLength(1);
    // Not yet due: the first retry waits five minutes.
    await retryStaffNotificationDeliveries(options);
    expect(emailPort.sent).toHaveLength(1);
    await client`update commerce_staff_notification_deliveries
      set updated_at = now() - interval '6 minutes'
      where event_id = ${eventId} and status = 'failed'`;
    await expect(
      retryStaffNotificationDeliveries(options),
    ).resolves.toMatchObject({
      retried: 1,
      sent: 1,
    });
    expect(new Set(emailPort.sent.map((m) => m.to))).toEqual(
      new Set([email(seller), email(admin)]),
    );
    const rows = (await deliveries(eventId)).filter(
      (r) => r.channel === "email",
    );
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(rows.map((r) => r.attempts).sort()).toEqual([1, 2]);
  });

  it("gives a delivery up after its last attempt", async () => {
    await setSettings({ emailEnabled: false, slackEnabled: true });
    const slackPort = new FakeStaffSlack();
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.completed",
    });
    const options = {
      store,
      channels: channels(new FakeStaffEmail(), slackPort),
      origin: null,
    };
    slackPort.failNext("transient");
    await handleStaffNotificationEvent(payload, options);
    for (let attempt = 2; attempt <= staffNotificationMaxAttempts; attempt++) {
      slackPort.failNext("transient");
      await client`update commerce_staff_notification_deliveries
        set updated_at = now() - interval '2 hours'
        where event_id = ${eventId}`;
      await retryStaffNotificationDeliveries(options);
    }
    const [slack] = (await deliveries(eventId)).filter(
      (r) => r.channel === "slack",
    );
    expect(slack).toMatchObject({
      status: "failed",
      reason: "gave_up",
      attempts: staffNotificationMaxAttempts,
    });
    await client`update commerce_staff_notification_deliveries
      set updated_at = now() - interval '2 hours' where event_id = ${eventId}`;
    await retryStaffNotificationDeliveries(options);
    expect(slackPort.posted).toHaveLength(0);
  });

  it("never sends again a delivery interrupted after the provider was called", async () => {
    await setSettings({ emailEnabled: true, slackEnabled: false });
    const emailPort = new FakeStaffEmail();
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.completed",
    });
    // A process that stopped between the provider call and its outcome
    // leaves the delivery `sending`.
    await client`insert into commerce_staff_notification_deliveries
      (event_id, channel, recipient_user_id, kind, status)
      values (${eventId}, 'email', ${seller}, 'mnda.completed', 'sending')`;
    await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(emailPort, new FakeStaffSlack()),
      origin: null,
    });
    expect(emailPort.sent).toHaveLength(0);
  });

  it("asks a requester who may approve their own request with the other approvers", async () => {
    await setSettings({ emailEnabled: false, slackEnabled: false });
    const id = await contract(admin);
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "contract.prepared",
      actor: { kind: "user", id: admin, display: "Ada Admin" },
    });
    await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(new FakeStaffEmail(), new FakeStaffSlack()),
      origin: null,
    });
    const recipients = await notified(eventId);
    expect(recipients).toContain(admin);
    expect(recipients).toContain(legal);
  });

  it("records a refused email as failed without retrying it", async () => {
    await setSettings({ emailEnabled: true, slackEnabled: false });
    const emailPort = new FakeStaffEmail();
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.declined",
    });
    emailPort.failNext("permanent");
    const options = {
      store,
      channels: channels(emailPort, new FakeStaffSlack()),
      origin: null,
    };
    await handleStaffNotificationEvent(payload, options);
    await handleStaffNotificationEvent(payload, options);
    expect(emailPort.sent).toHaveLength(0);
    const [row] = (await deliveries(eventId)).filter(
      (r) => r.channel === "email",
    );
    expect(row).toMatchObject({
      status: "failed",
      reason: "provider_rejected",
      attempts: 1,
    });
  });

  it("follows each person's email preferences and skips a channel that is not configured", async () => {
    await setSettings({ emailEnabled: true, slackEnabled: true });
    await repository.savePreferences(
      seller,
      { emailEnabled: true, emailMutedKinds: ["mnda.expired"] },
      { kind: "user", id: seller },
    );
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.expired",
    });
    await handleStaffNotificationEvent(payload, {
      store,
      channels: () => ({
        email: { configured: false, reason: "not_configured" },
        slack: { configured: false, reason: "not_configured" },
      }),
      origin: null,
    });
    expect(await notified(eventId)).toEqual([seller]);
    const rows = await deliveries(eventId);
    expect(rows.map((r) => [r.channel, r.status, r.reason])).toEqual([
      ["email", "skipped", "preference_off"],
      ["slack", "skipped", "kind_off"],
    ]);
  });

  it("asks every contract approver but the preparer, and posts no note to Slack", async () => {
    await setSettings({ emailEnabled: false, slackEnabled: true });
    const slackPort = new FakeStaffSlack();
    const id = await contract(legal);
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "contract.prepared",
      actor: { kind: "user", id: legal, display: "Lee Legal" },
    });
    await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(new FakeStaffEmail(), slackPort),
      origin: "https://commerce.fil.one",
    });
    const recipients = await notified(eventId);
    expect(recipients).toContain(admin);
    expect(recipients).not.toContain(legal);
    expect(recipients).not.toContain(seller);
    expect(recipients).not.toContain(departed);
    expect(slackPort.posted).toHaveLength(1);
    expect(slackPort.posted[0]?.text).toBe(
      `*Contract approval requested*: <https://commerce.fil.one/internal/contracts/${id}|${company}>`,
    );
  });

  it("tells the preparer their contract was sent back, with the approver's note", async () => {
    await setSettings({ emailEnabled: false, slackEnabled: false });
    const id = await contract(seller);
    await client`update commerce_contract_signing
      set approval_state = 'rejected', approver_id = ${legal}, approver_name = 'Lee Legal',
        decided_at = now(), rejection_reason = 'Use the 2026 DPA'
      where contract_id = ${id}`;
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "contract.rejected",
      actor: { kind: "user", id: legal },
    });
    await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(new FakeStaffEmail(), new FakeStaffSlack()),
      origin: null,
    });
    const [row] = await client<
      { recipient: string; detail: string; actor: string; href: string }[]
    >`
      select recipient_user_id::text as recipient, detail, actor_name as actor, href
      from commerce_staff_notifications where event_id = ${eventId}`;
    expect(row).toEqual({
      recipient: seller,
      detail: "Use the 2026 DPA",
      // The actor carried no name; the handler reads it from the user.
      actor: "Lee Legal",
      href: `/internal/contracts/${id}`,
    });
  });

  it("notifies nobody for an event older than the freshness window", async () => {
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.completed",
      occurredAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    });
    const result = await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(new FakeStaffEmail(), new FakeStaffSlack()),
      origin: null,
    });
    expect(result.status).toBe("stale");
    expect(await notified(eventId)).toEqual([]);
  });

  it("shows a reader only the kinds their permissions reach, and marks only their own read", async () => {
    const id = await mnda();
    const { eventId, payload } = await emit({
      aggregateId: id,
      eventType: "mnda.awaiting_countersignature",
    });
    await handleStaffNotificationEvent(payload, {
      store,
      channels: channels(new FakeStaffEmail(), new FakeStaffSlack()),
      origin: null,
    });
    const page = await repository.list(seller, staffNotificationKindList);
    const mine = page.notifications.find((n) => n.recordId === id);
    expect(mine?.kind).toBe("mnda.counterparty_signed");
    expect(mine?.readAt).toBeNull();
    expect(
      (await repository.list(seller, ["contract.executed"])).notifications.some(
        (n) => n.recordId === id,
      ),
    ).toBe(false);
    // The administrator cannot mark the seller's notification read.
    expect(await repository.markRead(admin, [mine?.id ?? ""])).toBe(0);
    expect(await repository.markRead(seller, [mine?.id ?? ""])).toBe(1);
    const before = await repository.unreadCount(
      admin,
      staffNotificationKindList,
    );
    expect(await repository.markAllRead(admin, staffNotificationKindList)).toBe(
      before,
    );
    expect(await repository.unreadCount(admin, staffNotificationKindList)).toBe(
      0,
    );
    expect(eventId).toBeTruthy();
  });

  it("audits a settings change and refuses a stale save", async () => {
    const read = await repository.settings();
    const current = {
      emailEnabled: read.emailEnabled,
      slackEnabled: read.slackEnabled,
      emailDisabledKinds: read.emailDisabledKinds,
      slackKinds: read.slackKinds,
      slackChannelLabel: read.slackChannelLabel,
    };
    await expect(
      repository.saveSettings(
        { ...current, slackChannelLabel: "#stale" },
        read.version - 1,
        { kind: "user", id: admin },
      ),
    ).rejects.toThrow("STAFF_NOTIFICATION_SETTINGS_CONFLICT");
    await setSettings({ slackChannelLabel: `#revenue-${run}` });
    const [event] = await client<{ after: { slackChannelLabel: string } }[]>`
      select after from audit_events
      where event_type = 'staff_notifications.settings_changed'
      order by created_at desc limit 1`;
    expect(event?.after.slackChannelLabel).toBe(`#revenue-${run}`);
    expect(settingsVersion).toBeGreaterThan(read.version);
  });
});
