import type {
  StaffNotification,
  StaffNotificationKind,
} from "@clockwork/contracts";

/**
 * The words of an email or Slack post. Staff surfaces are English only
 * (docs/operations/localization.md); the portal's inbox renders the same
 * kinds from apps/web/src/i18n/messages/operations-notifications.ts.
 */
type Words = { subject: string; actor: string };

const lines: Record<StaffNotificationKind, (w: Words) => string> = {
  "mnda.counterparty_signed": (w) =>
    `${w.subject} signed the MNDA. It is waiting for the Fil One countersignature.`,
  "mnda.completed": (w) => `The MNDA with ${w.subject} is fully signed.`,
  "mnda.attention": (w) => `The MNDA with ${w.subject} needs attention.`,
  "mnda.declined": (w) => `${w.subject} declined the MNDA.`,
  "mnda.expired": (w) =>
    `The MNDA with ${w.subject} expired before it was signed.`,
  "contract.approval_requested": (w) =>
    `${w.actor} asked for approval of the contract with ${w.subject}.`,
  "contract.approved": (w) =>
    `${w.actor} approved the contract with ${w.subject}.`,
  "contract.sent_back": (w) =>
    `${w.actor} sent the contract with ${w.subject} back.`,
  "contract.counterparty_signed": (w) =>
    `${w.subject} signed the contract. It is waiting for the Fil One countersignature.`,
  "contract.executed": (w) => `The contract with ${w.subject} is fully signed.`,
  "contract.attention": (w) =>
    `The contract with ${w.subject} needs attention.`,
  "contract.declined": (w) => `${w.subject} declined the contract.`,
  "contract.expired": (w) =>
    `The contract with ${w.subject} expired before it was signed.`,
  "handoff.requested": (w) => `${w.actor} handed ${w.subject} to operations.`,
  "handoff.in_progress": (w) => `${w.actor} started setting up ${w.subject}.`,
  "handoff.done": (w) => `Operations finished setting up ${w.subject}.`,
  "handoff.declined": (w) =>
    `${w.actor} declined the handoff for ${w.subject}.`,
  "capability.approval_requested": (w) =>
    `${w.actor} asked to turn on ${w.subject}.`,
  "capability.approved": (w) => `${w.actor} approved turning on ${w.subject}.`,
  "capability.rejected": (w) => `${w.actor} rejected turning on ${w.subject}.`,
  "price_book.approval_requested": (w) =>
    `${w.actor} asked for approval to activate ${w.subject}.`,
  "price_book.approved": (w) => `${w.actor} activated ${w.subject}.`,
  "price_book.rejected": (w) =>
    `${w.actor} rejected the activation of ${w.subject}.`,
};

/** Short Slack labels: the record type and its new status. */
const slackLabels: Record<StaffNotificationKind, string> = {
  "mnda.counterparty_signed": "MNDA waiting for countersignature",
  "mnda.completed": "MNDA fully signed",
  "mnda.attention": "MNDA needs attention",
  "mnda.declined": "MNDA declined",
  "mnda.expired": "MNDA expired",
  "contract.approval_requested": "Contract approval requested",
  "contract.approved": "Contract approved",
  "contract.sent_back": "Contract sent back",
  "contract.counterparty_signed": "Contract waiting for countersignature",
  "contract.executed": "Contract executed",
  "contract.attention": "Contract needs attention",
  "contract.declined": "Contract declined",
  "contract.expired": "Contract expired",
  "handoff.requested": "Handoff requested",
  "handoff.in_progress": "Handoff in progress",
  "handoff.done": "Handoff done",
  "handoff.declined": "Handoff declined",
  "capability.approval_requested": "Capability approval requested",
  "capability.approved": "Capability approved",
  "capability.rejected": "Capability rejected",
  "price_book.approval_requested": "Price book approval requested",
  "price_book.approved": "Price book activated",
  "price_book.rejected": "Price book rejected",
};

const words = (n: Pick<StaffNotification, "subject" | "actorName">) => ({
  subject: n.subject,
  actor: n.actorName ?? "Commerce",
});

export function notificationLine(
  n: Pick<StaffNotification, "kind" | "subject" | "actorName">,
) {
  return lines[n.kind](words(n));
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );

/** Slack's mrkdwn treats these three as control characters. */
const escapeSlack = (value: string) =>
  value.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c,
  );

const absolute = (origin: string | null, href: string) =>
  origin ? new URL(href, origin).toString() : null;

export function notificationEmail(
  n: Pick<
    StaffNotification,
    "kind" | "subject" | "actorName" | "detail" | "href"
  >,
  origin: string | null,
) {
  const line = notificationLine(n);
  const link = absolute(origin, n.href);
  const settings = absolute(origin, "/internal/notifications");
  const subject = `[Commerce] ${line}`.slice(0, 200);
  const text = [
    line,
    n.detail ? `\nNote: ${n.detail}` : "",
    link ? `\nOpen it in Commerce: ${link}` : "",
    "\n--",
    settings
      ? `You get this email because the record is yours or waits on you. Turn email off or choose which kinds you get at ${settings}.`
      : "You get this email because the record is yours or waits on you.",
  ]
    .filter(Boolean)
    .join("\n");
  const html = [
    `<p>${escapeHtml(line)}</p>`,
    n.detail ? `<p>Note: ${escapeHtml(n.detail)}</p>` : "",
    link ? `<p><a href="${escapeHtml(link)}">Open it in Commerce</a></p>` : "",
    `<p style="color:#666;font-size:12px">You get this email because the record is yours or waits on you.${
      settings
        ? ` <a href="${escapeHtml(settings)}">Turn email off or choose which kinds you get</a>.`
        : ""
    }</p>`,
  ]
    .filter(Boolean)
    .join("\n");
  return { subject, text, html };
}

/**
 * One Slack line: what changed, the record's name and a link. Never a note,
 * an amount or anything else from the record: the channel may be wider than
 * the people who can open it.
 */
export function notificationSlackText(
  n: Pick<StaffNotification, "kind" | "subject" | "href">,
  origin: string | null,
) {
  const link = absolute(origin, n.href);
  const subject = escapeSlack(n.subject);
  return `*${slackLabels[n.kind]}*: ${link ? `<${link}|${subject}>` : subject}`;
}

export function testEmail(origin: string | null) {
  const settings = absolute(origin, "/internal/notifications/settings");
  const line = "This is a test email from Fil One Commerce notifications.";
  return {
    subject: "[Commerce] Test email",
    text: settings ? `${line}\n\nSettings: ${settings}` : line,
    html: `<p>${escapeHtml(line)}</p>${
      settings ? `<p><a href="${escapeHtml(settings)}">Settings</a></p>` : ""
    }`,
  };
}

export function testSlackText(origin: string | null) {
  const settings = absolute(origin, "/internal/notifications/settings");
  return `*Commerce notifications test*: this channel will receive the posts chosen in ${
    settings ? `<${settings}|Notification settings>` : "Notification settings"
  }.`;
}
