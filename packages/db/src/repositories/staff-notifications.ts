import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  StaffNotificationPreferencesSchema,
  StaffNotificationSettingsSchema,
  defaultStaffNotificationPreferences,
  isStaffNotificationKind,
  staffNotificationPageSize,
  type Actor,
  type Permission,
  type StaffNotification,
  type StaffNotificationChannel,
  type StaffNotificationKind,
  type StaffNotificationPage,
  type StaffNotificationPreferences,
  type StaffNotificationSettingsRecord,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import {
  staffNotificationDeliveries,
  staffNotificationPreferences,
  staffNotificationSettings,
  staffNotifications,
} from "../schema/staff-notifications";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

/** Audit aggregate for the single settings row. */
const settingsAggregateId = "019a44ad-0000-7000-8000-000000001469";

type NotificationRow = typeof staffNotifications.$inferSelect;
type SettingsRow = typeof staffNotificationSettings.$inferSelect;

const notificationView = (row: NotificationRow): StaffNotification => ({
  id: row.id,
  kind: row.kind as StaffNotificationKind,
  recordType: row.recordType,
  recordId: row.recordId,
  href: row.href,
  subject: row.subject,
  actorName: row.actorName,
  detail: row.detail,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
});

/** Kinds this code no longer knows are dropped rather than refused, so a
 * kind retired later never locks an administrator out of saving. */
const knownKinds = (kinds: readonly string[]) =>
  kinds.filter(isStaffNotificationKind);

const settingsView = (row: SettingsRow): StaffNotificationSettingsRecord => ({
  emailEnabled: row.emailEnabled,
  slackEnabled: row.slackEnabled,
  emailDisabledKinds: knownKinds(row.emailDisabledKinds),
  slackKinds: knownKinds(row.slackKinds),
  slackChannelLabel: row.slackChannelLabel,
  version: row.version,
  updatedAt: row.updatedAt.toISOString(),
  updatedBy: row.updatedBy,
});

/**
 * The staff inbox, its settings and each person's preferences, as the portal
 * reads and changes them. The service role does not narrow rows, so every
 * read here is scoped to one recipient and to the kinds the caller says the
 * reader may see; the caller derives those from the reader's session.
 */
export class StaffNotificationRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  private visible(userId: string, kinds: readonly string[]) {
    return and(
      eq(staffNotifications.recipientUserId, userId),
      kinds.length ? inArray(staffNotifications.kind, [...kinds]) : sql`false`,
    );
  }

  /** The reader's newest notifications, older than `before` when given. */
  list(
    userId: string,
    kinds: readonly string[],
    options: {
      before?: { createdAt: string; id: string };
      limit?: number;
    } = {},
  ): Promise<StaffNotificationPage> {
    const limit = Math.min(
      Math.max(options.limit ?? staffNotificationPageSize, 1),
      staffNotificationPageSize,
    );
    return this.tx(async (tx) => {
      const before = options.before;
      const rows = await tx
        .select()
        .from(staffNotifications)
        .where(
          and(
            this.visible(userId, kinds),
            before
              ? or(
                  lt(staffNotifications.createdAt, new Date(before.createdAt)),
                  and(
                    eq(
                      staffNotifications.createdAt,
                      new Date(before.createdAt),
                    ),
                    lt(staffNotifications.id, before.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          desc(staffNotifications.createdAt),
          desc(staffNotifications.id),
        )
        .limit(limit + 1);
      const [count] = await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(staffNotifications)
        .where(
          and(this.visible(userId, kinds), isNull(staffNotifications.readAt)),
        );
      return {
        notifications: rows.slice(0, limit).map(notificationView),
        unread: count?.unread ?? 0,
        more: rows.length > limit,
      };
    });
  }

  unreadCount(userId: string, kinds: readonly string[]) {
    return this.tx(async (tx) => {
      const [count] = await tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(staffNotifications)
        .where(
          and(this.visible(userId, kinds), isNull(staffNotifications.readAt)),
        );
      return count?.unread ?? 0;
    });
  }

  /** Marks the reader's own notifications read; others' ids change nothing. */
  markRead(userId: string, ids: readonly string[]) {
    if (ids.length === 0) return Promise.resolve(0);
    return this.tx(async (tx) => {
      const rows = await tx
        .update(staffNotifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(staffNotifications.recipientUserId, userId),
            inArray(staffNotifications.id, [...ids]),
            isNull(staffNotifications.readAt),
          ),
        )
        .returning({ id: staffNotifications.id });
      return rows.length;
    });
  }

  /** Marks everything the reader can see read. */
  markAllRead(userId: string, kinds: readonly string[]) {
    return this.tx(async (tx) => {
      const rows = await tx
        .update(staffNotifications)
        .set({ readAt: sql`now()` })
        .where(
          and(this.visible(userId, kinds), isNull(staffNotifications.readAt)),
        )
        .returning({ id: staffNotifications.id });
      return rows.length;
    });
  }

  settings() {
    return this.tx((tx) => readSettings(tx));
  }

  /**
   * Saves the administrator's settings. `expectedVersion` refuses a save made
   * against a stale copy of the form; an unchanged save writes nothing.
   */
  saveSettings(raw: unknown, expectedVersion: number, actor: Actor) {
    const input = StaffNotificationSettingsSchema.parse(raw);
    return this.tx(async (tx) => {
      const [previous] = await tx
        .select()
        .from(staffNotificationSettings)
        .for("update");
      if (!previous) throw new Error("STAFF_NOTIFICATION_SETTINGS_MISSING");
      if (previous.version !== expectedVersion)
        throw new Error("STAFF_NOTIFICATION_SETTINGS_CONFLICT");
      const before = settingsView(previous);
      const same =
        before.emailEnabled === input.emailEnabled &&
        before.slackEnabled === input.slackEnabled &&
        before.slackChannelLabel === input.slackChannelLabel &&
        sameList(before.emailDisabledKinds, input.emailDisabledKinds) &&
        sameList(before.slackKinds, input.slackKinds);
      if (same) return before;
      const version = previous.version + 1;
      const [next] = await tx
        .update(staffNotificationSettings)
        .set({
          ...input,
          version,
          updatedAt: new Date(),
          updatedBy: actor.kind === "user" ? actor.id : null,
        })
        .where(eq(staffNotificationSettings.singleton, true))
        .returning();
      if (!next) throw new Error("STAFF_NOTIFICATION_SETTINGS_MISSING");
      const beforeImage = {
        emailEnabled: before.emailEnabled,
        slackEnabled: before.slackEnabled,
        emailDisabledKinds: before.emailDisabledKinds,
        slackKinds: before.slackKinds,
        slackChannelLabel: before.slackChannelLabel,
      };
      await appendAuditAndOutbox(tx, {
        aggregateType: "staff_notification_settings",
        aggregateId: settingsAggregateId,
        aggregateVersion: version,
        eventType: "staff_notifications.settings_changed",
        actor,
        requestId: randomUUID(),
        before: beforeImage,
        after: input,
      });
      return settingsView(next);
    });
  }

  preferences(userId: string): Promise<StaffNotificationPreferences> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(staffNotificationPreferences)
        .where(eq(staffNotificationPreferences.userId, userId));
      return row
        ? {
            emailEnabled: row.emailEnabled,
            emailMutedKinds: knownKinds(row.emailMutedKinds),
          }
        : { ...defaultStaffNotificationPreferences };
    });
  }

  /** Saves the reader's own choices and records the change in their history. */
  savePreferences(userId: string, raw: unknown, actor: Actor) {
    const input = StaffNotificationPreferencesSchema.parse(raw);
    return this.tx(async (tx) => {
      const [previous] = await tx
        .select()
        .from(staffNotificationPreferences)
        .where(eq(staffNotificationPreferences.userId, userId))
        .for("update");
      if (
        previous &&
        previous.emailEnabled === input.emailEnabled &&
        sameList(knownKinds(previous.emailMutedKinds), input.emailMutedKinds)
      )
        return input;
      const version = (previous?.version ?? 0) + 1;
      await tx
        .insert(staffNotificationPreferences)
        .values({ userId, ...input, version })
        .onConflictDoUpdate({
          target: staffNotificationPreferences.userId,
          set: { ...input, version, updatedAt: new Date() },
        });
      await appendAuditAndOutbox(tx, {
        // Each save is its own audit aggregate, so it never competes with
        // the version chain of the person's identity record.
        aggregateType: "user",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "staff_notifications.preferences_changed",
        actor,
        requestId: randomUUID(),
        metadata: { userId, preferenceVersion: version },
        ...(previous
          ? {
              before: {
                emailEnabled: previous.emailEnabled,
                emailMutedKinds: previous.emailMutedKinds,
              },
            }
          : {}),
        after: input,
      });
      return input;
    });
  }

  /** Records an administrator's test message and what the provider said. */
  recordTest(
    channel: StaffNotificationChannel,
    result: { delivered: boolean; code: string | null },
    actor: Actor,
  ) {
    return this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        aggregateType: "staff_notification_settings",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "staff_notifications.test_sent",
        actor,
        requestId: randomUUID(),
        after: { channel, delivered: result.delivered, code: result.code },
      }),
    );
  }

  /** The latest delivery decisions, for the settings page. */
  recentDeliveries(limit = 20) {
    return this.tx((tx) =>
      tx
        .select({
          channel: staffNotificationDeliveries.channel,
          kind: staffNotificationDeliveries.kind,
          status: staffNotificationDeliveries.status,
          reason: staffNotificationDeliveries.reason,
          attempts: staffNotificationDeliveries.attempts,
          providerCode: staffNotificationDeliveries.providerCode,
          updatedAt: staffNotificationDeliveries.updatedAt,
        })
        .from(staffNotificationDeliveries)
        .orderBy(desc(staffNotificationDeliveries.updatedAt))
        .limit(Math.min(Math.max(limit, 1), 100)),
    ).then((rows) =>
      rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    );
  }
}

function sameList(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

async function readSettings(tx: RuntimeTransaction) {
  const [row] = await tx.select().from(staffNotificationSettings);
  if (!row) throw new Error("STAFF_NOTIFICATION_SETTINGS_MISSING");
  return settingsView(row);
}

/** A staff member a notification can go to. */
export type StaffRecipient = {
  id: string;
  email: string;
  name: string;
};

/** The record a notification names, as the mapping reads it. */
export type StaffNotificationMnda = {
  id: string;
  company: string;
  ownerId: string;
  countersignerEmail: string | null;
  error: string | null;
};
export type StaffNotificationContract = {
  id: string;
  counterpartyName: string;
  documentName: string | null;
  createdById: string;
  preparerId: string | null;
  approvalRequired: boolean;
  approvalState: string | null;
  rejectionReason: string | null;
  error: string | null;
};
export type StaffNotificationHandoff = {
  id: string;
  counterpartyLegalName: string;
  requestedById: string;
  contractIds: string[];
  decisionNote: string | null;
};
export type StaffNotificationCapabilityRequest = {
  id: string;
  capabilityKey: string;
  requestedBy: string;
  status: string;
  decisionReason: string | null;
};
export type StaffNotificationPriceBook = {
  id: string;
  name: string;
  currency: string;
  version: number;
};

/** One notification as the handler writes it. */
export interface StaffNotificationDraft {
  recipientUserId: string;
  kind: StaffNotificationKind;
  recordType: string;
  recordId: string;
  href: string;
  subject: string;
  actorName: string | null;
  detail: string | null;
}

export interface StaffNotificationDeliveryState {
  status: "sending" | "sent" | "skipped" | "failed";
  reason: string | null;
  attempts: number;
}

const staffHolding = (permissions: readonly Permission[]) =>
  sql.join(
    permissions.map(
      (permission) =>
        sql`public.member_has_permission(u.id, ${permission}::text)`,
    ),
    sql` and `,
  );

/**
 * What the staff notification handler reads and writes: the records an event
 * names, the staff who may receive it, the notifications themselves and the
 * outcome of each email and Slack delivery. Runs on the service role in the
 * workflow runtime.
 */
export class StaffNotificationStore {
  constructor(private readonly db: RuntimeDatabase) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /** The given people who are staff and hold every permission. */
  staff(
    userIds: readonly string[],
    permissions: readonly [Permission, ...Permission[]],
  ): Promise<StaffRecipient[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return Promise.resolve([]);
    return this.tx(async (tx) => [
      ...(await tx.execute<StaffRecipient>(sql`
        select u.id::text as id, u.email, u.name
        from commerce_users u
        where u.is_internal_staff
          and u.id::text in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})
          and ${staffHolding(permissions)}
        order by u.id`)),
    ]);
  }

  /** Every staff member holding every permission. */
  holders(
    permissions: readonly [Permission, ...Permission[]],
  ): Promise<StaffRecipient[]> {
    return this.tx(async (tx) => [
      ...(await tx.execute<StaffRecipient>(sql`
        select u.id::text as id, u.email, u.name
        from commerce_users u
        where u.is_internal_staff and ${staffHolding(permissions)}
        order by u.id`)),
    ]);
  }

  /** The staff member with this email, if there is one. */
  staffIdByEmail(email: string): Promise<string | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<{ id: string }>(sql`
        select id::text as id from commerce_users
        where is_internal_staff and lower(email) = lower(${email})`);
      return row?.id ?? null;
    });
  }

  /** A person's name, for an event whose actor carries none. */
  userName(userId: string): Promise<string | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<{ name: string }>(sql`
        select name from commerce_users where id::text = ${userId}`);
      return row?.name ?? null;
    });
  }

  canSelfApprove(userId: string): Promise<boolean> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<{ allowed: boolean }>(
        sql`select public.member_can_self_approve(${userId}::uuid) as allowed`,
      );
      return row?.allowed === true;
    });
  }

  mnda(id: string): Promise<StaffNotificationMnda | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<StaffNotificationMnda>(sql`
        select id::text as id,
          coalesce(nullif(input->>'company', ''), 'MNDA') as company,
          owner_id::text as "ownerId",
          nullif(countersigner->>'email', '') as "countersignerEmail",
          error
        from commerce_mnda_requests where id::text = ${id}`);
      return row ?? null;
    });
  }

  contract(id: string): Promise<StaffNotificationContract | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<StaffNotificationContract>(sql`
        select c.id::text as id, c.counterparty_name as "counterpartyName",
          s.document_name as "documentName",
          c.created_by_id::text as "createdById",
          s.preparer_id::text as "preparerId",
          coalesce(s.approval_required, false) as "approvalRequired",
          s.approval_state as "approvalState",
          s.rejection_reason as "rejectionReason",
          s.error
        from commerce_contracts c
        left join commerce_contract_signing s on s.contract_id = c.id
        where c.id::text = ${id}`);
      return row ?? null;
    });
  }

  handoff(id: string): Promise<StaffNotificationHandoff | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<StaffNotificationHandoff>(sql`
        select id::text as id,
          counterparty_legal_name as "counterpartyLegalName",
          requested_by_id::text as "requestedById",
          contract_ids::text[] as "contractIds",
          decision_note as "decisionNote"
        from commerce_handoff_requests where id::text = ${id}`);
      return row ?? null;
    });
  }

  capabilityRequest(
    id: string,
  ): Promise<StaffNotificationCapabilityRequest | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<StaffNotificationCapabilityRequest>(sql`
        select id::text as id, capability_key as "capabilityKey",
          requested_by::text as "requestedBy", status,
          decision_reason as "decisionReason"
        from system_capability_requests where id::text = ${id}`);
      return row ?? null;
    });
  }

  priceBook(id: string): Promise<StaffNotificationPriceBook | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<StaffNotificationPriceBook>(sql`
        select id::text as id, name, currency, version
        from price_books where id::text = ${id}`);
      return row ?? null;
    });
  }

  /** Who asked for a price book's activation, by the approval's id. */
  approvalRequester(approvalId: string): Promise<string | null> {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<{ requestedBy: string }>(sql`
        select requested_by::text as "requestedBy"
        from approvals where id::text = ${approvalId}`);
      return row?.requestedBy ?? null;
    });
  }

  /**
   * Writes the event's notifications. One per recipient per event: a replay
   * writes nothing new. Returns the notifications as stored, including ones
   * an earlier delivery of the same event wrote.
   */
  record(eventId: string, drafts: readonly StaffNotificationDraft[]) {
    return this.tx(async (tx) => {
      if (drafts.length)
        await tx
          .insert(staffNotifications)
          .values(drafts.map((draft) => ({ ...draft, eventId })))
          .onConflictDoNothing({
            target: [
              staffNotifications.eventId,
              staffNotifications.recipientUserId,
            ],
          });
      const rows = await tx
        .select()
        .from(staffNotifications)
        .where(eq(staffNotifications.eventId, eventId));
      return rows.map((row) => ({
        ...notificationView(row),
        recipientUserId: row.recipientUserId,
      }));
    });
  }

  /** The administrator's settings and the recipients' own preferences. */
  deliveryContext(recipientIds: readonly string[]) {
    return this.tx(async (tx) => {
      const settings = await readSettings(tx);
      const ids = [...new Set(recipientIds)];
      const rows = ids.length
        ? await tx
            .select()
            .from(staffNotificationPreferences)
            .where(inArray(staffNotificationPreferences.userId, ids))
        : [];
      const preferences = new Map<string, StaffNotificationPreferences>(
        rows.map((row) => [
          row.userId,
          {
            emailEnabled: row.emailEnabled,
            emailMutedKinds: knownKinds(row.emailMutedKinds),
          },
        ]),
      );
      return { settings, preferences };
    });
  }

  /** What already happened to each delivery of this event. */
  deliveries(eventId: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(staffNotificationDeliveries)
        .where(eq(staffNotificationDeliveries.eventId, eventId));
      return new Map<string, StaffNotificationDeliveryState>(
        rows.map((row) => [
          deliveryKey(row.channel, row.recipientUserId),
          { status: row.status, reason: row.reason, attempts: row.attempts },
        ]),
      );
    });
  }

  /**
   * Records one delivery's outcome. A sent delivery is never overwritten.
   * `sending` is written before the provider is called, so a crash between
   * the call and its outcome leaves a delivery nothing sends again.
   */
  recordDelivery(input: StaffNotificationDeliveryRecord) {
    return this.tx(async (tx) => {
      await tx.execute(sql`
        insert into commerce_staff_notification_deliveries
          (event_id, channel, recipient_user_id, kind, status, reason,
           provider_message_id, provider_code)
        values (${input.eventId}::uuid, ${input.channel}, ${input.recipientUserId}::uuid,
          ${input.kind}, ${input.status}, ${input.reason},
          ${input.providerMessageId ?? null}, ${input.providerCode ?? null})
        on conflict on constraint commerce_staff_notification_deliveries_unique
        do update set status = excluded.status, reason = excluded.reason,
          provider_message_id = excluded.provider_message_id,
          provider_code = excluded.provider_code,
          updated_at = now()
        where commerce_staff_notification_deliveries.status <> 'sent'`);
    });
  }

  /**
   * Claims deliveries the provider could not take, for the retry task: each
   * waits longer after every attempt (5, 10, 15 ... minutes, at most an hour),
   * is retried only within a day of the event and at most `maxAttempts`
   * times. A claimed delivery is marked `sending` with its attempt counted, so
   * two retry runs never send it twice. Returns what to send: the stored
   * notification for an email, or any notification of the event for a Slack
   * post; a Slack post whose event notified nobody in the portal cannot be
   * rebuilt and is left failed.
   */
  claimRetries(input: { maxAttempts: number; limit: number }) {
    return this.tx(async (tx) => [
      ...(await tx.execute<StaffNotificationRetry>(sql`
        with due as (
          select d.id
          from commerce_staff_notification_deliveries d
          where d.status = 'failed' and d.reason = 'provider_unavailable'
            and d.attempts < ${input.maxAttempts}
            and d.created_at > now() - interval '24 hours'
            and d.updated_at < now() - make_interval(mins => least(60, 5 * d.attempts))
            and exists (
              select 1 from commerce_staff_notifications n
              where n.event_id = d.event_id
                and (d.recipient_user_id is null or n.recipient_user_id = d.recipient_user_id))
          order by d.updated_at
          limit ${input.limit}
          for update skip locked
        ), claimed as (
          update commerce_staff_notification_deliveries d
          set status = 'sending', reason = null, attempts = d.attempts + 1,
            updated_at = now()
          from due where d.id = due.id
          returning d.event_id, d.channel, d.recipient_user_id, d.kind, d.attempts
        )
        select c.event_id::text as "eventId", c.channel,
          c.recipient_user_id::text as "recipientUserId", c.kind, c.attempts,
          u.email, n.subject, n.href, n.actor_name as "actorName", n.detail
        from claimed c
        left join commerce_users u on u.id = c.recipient_user_id
        join lateral (
          select subject, href, actor_name, detail
          from commerce_staff_notifications n
          where n.event_id = c.event_id
            and (c.recipient_user_id is null or n.recipient_user_id = c.recipient_user_id)
          order by n.created_at, n.id
          limit 1
        ) n on true`)),
    ]);
  }
}

/** One delivery's outcome, as the handler and the retry task record it. */
export interface StaffNotificationDeliveryRecord {
  eventId: string;
  channel: StaffNotificationChannel;
  recipientUserId: string | null;
  kind: StaffNotificationKind;
  status: "sending" | "sent" | "skipped" | "failed";
  reason: string | null;
  providerMessageId?: string | null;
  providerCode?: string | null;
}

/** A delivery claimed for another attempt, with what it says. */
export type StaffNotificationRetry = {
  eventId: string;
  channel: StaffNotificationChannel;
  recipientUserId: string | null;
  kind: string;
  attempts: number;
  email: string | null;
  subject: string;
  href: string;
  actorName: string | null;
  detail: string | null;
};

export const deliveryKey = (
  channel: StaffNotificationChannel,
  recipientUserId: string | null,
) => `${channel}:${recipientUserId ?? "channel"}`;
