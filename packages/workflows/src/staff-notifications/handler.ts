import { z } from "zod";

import {
  isStaffNotificationKind,
  staffNotificationKinds,
  type StaffNotification,
  type StaffNotificationKind,
  type StaffNotificationPreferences,
  type StaffNotificationSettings,
} from "@clockwork/contracts";
import {
  deliveryKey,
  type StaffNotificationDeliveryRecord,
  type StaffNotificationDraft,
  type StaffNotificationStore,
  type StaffRecipient,
} from "@clockwork/db";
import type {
  StaffDeliveryResult,
  StaffNotificationChannels,
} from "@clockwork/integrations";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";
import { notificationEmail, notificationSlackText } from "./messages";
import {
  staffNotificationSources,
  type StaffNotificationEvent,
  type StaffNotificationSource,
} from "./sources";

/**
 * Turns a notifying audit event into in-app notifications and their email and
 * Slack deliveries. It runs from the outbox, after the change that caused the
 * event has committed, so nothing here can slow or fail a signing transition
 * or any other request, and it never fails the outbox message for a
 * provider's sake: a delivery the provider could not take is recorded as
 * failed and retried by `retryStaffNotificationDeliveries` on its own
 * schedule.
 *
 * Replays are harmless: notifications are unique per event and recipient, and
 * a delivery recorded once (sending, sent, skipped or failed) is never
 * attempted again from here.
 */

/** Events older than this notify nobody, so a backlog drained after an
 * outage does not flood inboxes with old news. */
export const staffNotificationFreshnessMs = 72 * 60 * 60 * 1000;

/** Attempts a delivery gets, the first one included, before it is given up. */
export const staffNotificationMaxAttempts = 6;

const PayloadSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  actor: z
    .object({
      kind: z.string(),
      id: z.string(),
      display: z.string().optional(),
    })
    .passthrough(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type StaffNotificationHandlerStore = Pick<
  StaffNotificationStore,
  | "holders"
  | "staff"
  | "staffIdByEmail"
  | "canSelfApprove"
  | "userName"
  | "mnda"
  | "contract"
  | "handoff"
  | "capabilityRequest"
  | "priceBook"
  | "approvalRequester"
  | "record"
  | "deliveryContext"
  | "deliveries"
  | "recordDelivery"
>;

export interface StaffNotificationHandlerOptions {
  store: StaffNotificationHandlerStore;
  /** The channels this deployment can send to; tests supply fakes. */
  channels: () => StaffNotificationChannels;
  /** The portal's public origin, for links in email and Slack. */
  origin: string | null;
  sources?: Readonly<Record<string, StaffNotificationSource>>;
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

const jsonLog = (entry: Record<string, unknown>) =>
  // i18n-exempt: operator log; identifiers and codes only
  console.log(JSON.stringify(entry));

const clip = (value: string | null | undefined, max: number) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

type Message = Pick<
  StaffNotification,
  "kind" | "subject" | "href" | "actorName" | "detail"
>;

type Outcome = Pick<
  StaffNotificationDeliveryRecord,
  "status" | "reason" | "providerMessageId" | "providerCode"
>;

/** What the provider's answer means for the delivery. `lastAttempt` turns an
 * outage on the final attempt into giving up. */
function outcome(result: StaffDeliveryResult, lastAttempt: boolean): Outcome {
  if (result.ok)
    return {
      status: "sent",
      reason: null,
      providerMessageId: result.messageId,
    };
  return {
    status: "failed",
    reason:
      result.kind === "permanent"
        ? "provider_rejected"
        : lastAttempt
          ? "gave_up"
          : "provider_unavailable",
    providerCode: result.code.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80),
  };
}

function emailBlocked(
  kind: StaffNotificationKind,
  settings: StaffNotificationSettings,
  preferences: StaffNotificationPreferences | undefined,
): string | null {
  if (!settings.emailEnabled) return "channel_off";
  if (settings.emailDisabledKinds.includes(kind)) return "kind_off";
  if (preferences && !preferences.emailEnabled) return "preference_off";
  if (preferences?.emailMutedKinds.includes(kind)) return "preference_off";
  return null;
}

function slackBlocked(
  kind: StaffNotificationKind,
  settings: StaffNotificationSettings,
): string | null {
  if (!settings.slackEnabled) return "channel_off";
  if (!settings.slackKinds.includes(kind)) return "kind_off";
  return null;
}

/**
 * One delivery: skipped when settings, the person's preferences or the
 * deployment say so; otherwise recorded as `sending`, sent, and recorded
 * with what the provider answered.
 */
async function attempt(
  store: Pick<StaffNotificationStore, "recordDelivery">,
  key: Pick<
    StaffNotificationDeliveryRecord,
    "eventId" | "channel" | "recipientUserId" | "kind"
  >,
  blocked: string | null,
  send: (() => Promise<StaffDeliveryResult>) | { unavailable: string },
  options: { lastAttempt: boolean; claimed?: boolean },
) {
  if (blocked || "unavailable" in send) {
    await store.recordDelivery({
      ...key,
      status: "skipped",
      reason: blocked ?? (send as { unavailable: string }).unavailable,
    });
    return "skipped" as const;
  }
  if (!options.claimed)
    await store.recordDelivery({ ...key, status: "sending", reason: null });
  const result = outcome(await send(), options.lastAttempt);
  await store.recordDelivery({ ...key, ...result });
  return result.status;
}

/** The handler for one event; exported for the integration suite. */
export async function handleStaffNotificationEvent(
  rawPayload: unknown,
  options: StaffNotificationHandlerOptions,
) {
  const {
    store,
    sources = staffNotificationSources,
    now = () => new Date(),
    log = jsonLog,
  } = options;
  const parsed = PayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    log({ event: "STAFF_NOTIFICATION_PAYLOAD_INVALID" });
    return { status: "ignored" as const };
  }
  const event: StaffNotificationEvent = parsed.data;
  const source = sources[event.eventType];
  if (!source) return { status: "ignored" as const };
  if (
    now().getTime() - Date.parse(event.occurredAt) >
    staffNotificationFreshnessMs
  ) {
    log({
      event: "STAFF_NOTIFICATION_STALE",
      eventId: event.eventId,
      eventType: event.eventType,
    });
    return { status: "stale" as const };
  }
  const resolution = await source(event, store);
  if (!resolution) return { status: "ignored" as const };

  const permissions =
    resolution.permissions ??
    staffNotificationKinds[resolution.kind].permissions;
  // Nobody is told about their own action, except a requester who may
  // approve their own request and is asked like any approver.
  const actorId = event.actor.kind === "user" ? event.actor.id : null;
  const recipients: StaffRecipient[] = await store.staff(
    resolution.recipients.filter(
      (id) => id !== actorId || resolution.includesActor === true,
    ),
    permissions,
  );
  const actorName =
    event.actor.kind === "user"
      ? (clip(event.actor.display, 200) ??
        clip(await store.userName(event.actor.id), 200))
      : null;
  const message: Message = {
    kind: resolution.kind,
    subject: clip(resolution.subject, 300) ?? resolution.recordType,
    href: resolution.href,
    actorName,
    detail: clip(resolution.detail, 2000),
  };
  const drafts: StaffNotificationDraft[] = recipients.map((recipient) => ({
    ...message,
    recipientUserId: recipient.id,
    recordType: resolution.recordType,
    recordId: resolution.recordId,
  }));
  const stored = await store.record(event.eventId, drafts);
  const delivered = await deliver(
    event.eventId,
    message,
    stored.map((n) => n.recipientUserId),
    recipients,
    options,
  );
  return {
    status: "notified" as const,
    notifications: stored.length,
    ...delivered,
  };
}

async function deliver(
  eventId: string,
  message: Message,
  notified: readonly string[],
  recipients: readonly StaffRecipient[],
  options: StaffNotificationHandlerOptions,
) {
  const { store, origin } = options;
  const kind = message.kind;
  const channels = options.channels();
  // Email goes to the people notified for this event who are still allowed
  // to see it; a replay after someone lost access sends them nothing.
  const emails = new Map(recipients.map((r) => [r.id, r.email]));
  const emailRecipients = [...new Set(notified)].filter((id) => emails.has(id));
  const { settings, preferences } =
    await store.deliveryContext(emailRecipients);
  const previous = await store.deliveries(eventId);
  const outcomes: string[] = [];
  const firstAttempt = { lastAttempt: staffNotificationMaxAttempts <= 1 };

  for (const recipientId of emailRecipients) {
    if (previous.has(deliveryKey("email", recipientId))) continue;
    const email = channels.email;
    outcomes.push(
      await attempt(
        store,
        { eventId, channel: "email", recipientUserId: recipientId, kind },
        emailBlocked(kind, settings, preferences.get(recipientId)),
        email.configured
          ? () =>
              email.port.send({
                to: emails.get(recipientId) ?? "",
                ...notificationEmail(message, origin),
              })
          : { unavailable: email.reason },
        firstAttempt,
      ),
    );
  }

  // Slack is one post per event to the configured channel, whoever was
  // notified in the portal.
  if (!previous.has(deliveryKey("slack", null))) {
    const slack = channels.slack;
    outcomes.push(
      await attempt(
        store,
        { eventId, channel: "slack", recipientUserId: null, kind },
        slackBlocked(kind, settings),
        slack.configured
          ? () =>
              slack.port.post({ text: notificationSlackText(message, origin) })
          : { unavailable: slack.reason },
        firstAttempt,
      ),
    );
  }
  return {
    sent: outcomes.filter((o) => o === "sent").length,
    failed: outcomes.filter((o) => o === "failed").length,
  };
}

/**
 * Sends again what the provider could not take earlier: each delivery waits
 * longer after every attempt and is given up after
 * `staffNotificationMaxAttempts` or a day. Settings, preferences and the
 * recipient's access are checked again, so a channel switched off meanwhile
 * sends nothing.
 */
export async function retryStaffNotificationDeliveries(
  options: Pick<
    StaffNotificationHandlerOptions,
    "channels" | "origin" | "log"
  > & {
    store: Pick<
      StaffNotificationStore,
      "claimRetries" | "deliveryContext" | "recordDelivery" | "staff"
    >;
    limit?: number;
  },
) {
  const { store, origin, log = jsonLog } = options;
  const claimed = await store.claimRetries({
    maxAttempts: staffNotificationMaxAttempts,
    limit: options.limit ?? 50,
  });
  if (claimed.length === 0) return { retried: 0, sent: 0 };
  const channels = options.channels();
  const { settings, preferences } = await store.deliveryContext(
    claimed.flatMap((row) =>
      row.recipientUserId ? [row.recipientUserId] : [],
    ),
  );
  let sent = 0;
  for (const row of claimed) {
    const kind = row.kind;
    const key = {
      eventId: row.eventId,
      channel: row.channel,
      recipientUserId: row.recipientUserId,
    };
    if (!isStaffNotificationKind(kind)) {
      await store.recordDelivery({
        ...key,
        kind: kind as StaffNotificationKind,
        status: "skipped",
        reason: "kind_off",
      });
      continue;
    }
    const message: Message = {
      kind,
      subject: row.subject,
      href: row.href,
      actorName: row.actorName,
      detail: row.detail,
    };
    const retry = {
      lastAttempt: row.attempts >= staffNotificationMaxAttempts,
      claimed: true,
    };
    let status: string;
    if (row.channel === "email") {
      const allowed =
        row.recipientUserId !== null &&
        (
          await store.staff(
            [row.recipientUserId],
            staffNotificationKinds[kind].permissions,
          )
        ).length === 1;
      const email = channels.email;
      status = await attempt(
        store,
        { ...key, kind },
        allowed
          ? emailBlocked(
              kind,
              settings,
              preferences.get(row.recipientUserId ?? ""),
            )
          : "no_access",
        email.configured && row.email
          ? () =>
              email.port.send({
                to: row.email ?? "",
                ...notificationEmail(message, origin),
              })
          : { unavailable: email.configured ? "not_configured" : email.reason },
        retry,
      );
    } else {
      const slack = channels.slack;
      status = await attempt(
        store,
        { ...key, kind },
        slackBlocked(kind, settings),
        slack.configured
          ? () =>
              slack.port.post({ text: notificationSlackText(message, origin) })
          : { unavailable: slack.reason },
        retry,
      );
    }
    if (status === "sent") sent += 1;
  }
  log({ event: "STAFF_NOTIFICATION_RETRY", retried: claimed.length, sent });
  return { retried: claimed.length, sent };
}

/**
 * One outbox handler per notifying event type. The workflow runtime chains
 * them after any handler another feature already registered for the topic.
 */
export function createStaffNotificationOutboxHandlers(
  options: StaffNotificationHandlerOptions,
): Map<string, OutboxTopicHandler> {
  const sources = options.sources ?? staffNotificationSources;
  const handler: OutboxTopicHandler = async ({ payload }) => {
    await handleStaffNotificationEvent(payload, options);
  };
  return new Map(Object.keys(sources).map((topic) => [topic, handler]));
}
