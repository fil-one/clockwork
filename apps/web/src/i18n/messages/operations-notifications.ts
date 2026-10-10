import { defineStaffMessages } from "../define";

/**
 * Staff notifications: the bell in the staff shell, the inbox at
 * /internal/notifications, each person's email preferences and the
 * administrator's settings at /internal/notifications/settings. Part of the
 * operations module. Email and Slack wording lives with the delivery code in
 * packages/workflows/src/staff-notifications/messages.ts.
 */
export const notificationMessages = defineStaffMessages({
  "operations.notifications.bell": { en: "Notifications" },
  "operations.notifications.bellUnread": {
    count: "count",
    en: {
      one: "Notifications, {count} unread",
      other: "Notifications, {count} unread",
    },
  },

  "operations.notifications.title": { en: "Notifications" },
  "operations.notifications.description": {
    en: "Changes to MNDAs, contracts, handoffs and approvals that are yours or wait on you.",
  },
  "operations.notifications.unreadCount": {
    count: "count",
    en: { one: "{count} unread", other: "{count} unread" },
  },
  "operations.notifications.markAllRead": { en: "Mark all read" },
  "operations.notifications.markRead": { en: "Mark read" },
  "operations.notifications.markReadNamed": {
    en: "Mark read: {subject}",
  },
  "operations.notifications.unread": { en: "Unread" },
  "operations.notifications.open": { en: "Open" },
  "operations.notifications.openNamed": { en: "Open {subject}" },
  "operations.notifications.note": { en: "Note: {note}" },
  "operations.notifications.empty.title": { en: "Nothing new" },
  "operations.notifications.empty.description": {
    en: "When an MNDA or contract you sent changes, or something waits on your approval, it shows here.",
  },
  "operations.notifications.olderHidden": {
    en: "Showing the newest {count}. Older notifications are kept.",
  },
  "operations.notifications.unavailable": {
    en: "Notifications could not be loaded right now. Reload the page in a minute.",
  },
  "operations.notifications.forbidden": {
    en: "Notifications are for Fil One staff signed in with a second factor.",
  },
  "operations.notifications.demo": {
    en: "These notifications are examples. Nothing in the demo sends email or Slack messages.",
  },
  "operations.notifications.error": {
    en: "That did not save. Try again.",
  },
  "operations.notifications.settingsLink": { en: "Notification settings" },

  "operations.notifications.kind.mnda.counterparty_signed": {
    en: "{subject} signed the MNDA. It is waiting for the Fil One countersignature.",
  },
  "operations.notifications.kind.mnda.completed": {
    en: "The MNDA with {subject} is fully signed.",
  },
  "operations.notifications.kind.mnda.attention": {
    en: "The MNDA with {subject} needs attention.",
  },
  "operations.notifications.kind.mnda.declined": {
    en: "{subject} declined the MNDA.",
  },
  "operations.notifications.kind.mnda.expired": {
    en: "The MNDA with {subject} expired before it was signed.",
  },
  "operations.notifications.kind.contract.approval_requested": {
    en: "{actor} asked for approval of the contract with {subject}.",
  },
  "operations.notifications.kind.contract.approved": {
    en: "{actor} approved the contract with {subject}.",
  },
  "operations.notifications.kind.contract.sent_back": {
    en: "{actor} sent the contract with {subject} back.",
  },
  "operations.notifications.kind.contract.counterparty_signed": {
    en: "{subject} signed the contract. It is waiting for the Fil One countersignature.",
  },
  "operations.notifications.kind.contract.executed": {
    en: "The contract with {subject} is fully signed.",
  },
  "operations.notifications.kind.contract.attention": {
    en: "The contract with {subject} needs attention.",
  },
  "operations.notifications.kind.contract.declined": {
    en: "{subject} declined the contract.",
  },
  "operations.notifications.kind.contract.expired": {
    en: "The contract with {subject} expired before it was signed.",
  },
  "operations.notifications.kind.handoff.requested": {
    en: "{actor} handed {subject} to operations.",
  },
  "operations.notifications.kind.handoff.in_progress": {
    en: "{actor} started setting up {subject}.",
  },
  "operations.notifications.kind.handoff.done": {
    en: "Operations finished setting up {subject}.",
  },
  "operations.notifications.kind.handoff.declined": {
    en: "{actor} declined the handoff for {subject}.",
  },
  "operations.notifications.kind.capability.approval_requested": {
    en: "{actor} asked to turn on {subject}.",
  },
  "operations.notifications.kind.capability.approved": {
    en: "{actor} approved turning on {subject}.",
  },
  "operations.notifications.kind.capability.rejected": {
    en: "{actor} rejected turning on {subject}.",
  },
  "operations.notifications.kind.price_book.approval_requested": {
    en: "{actor} asked for approval to activate {subject}.",
  },
  "operations.notifications.kind.price_book.approved": {
    en: "{actor} activated {subject}.",
  },
  "operations.notifications.kind.price_book.rejected": {
    en: "{actor} rejected the activation of {subject}.",
  },
  "operations.notifications.someone": { en: "Someone" },

  "operations.notifications.label.mnda.counterparty_signed": {
    en: "MNDA signed by the partner",
  },
  "operations.notifications.label.mnda.completed": {
    en: "MNDA fully signed",
  },
  "operations.notifications.label.mnda.attention": {
    en: "MNDA needs attention",
  },
  "operations.notifications.label.mnda.declined": { en: "MNDA declined" },
  "operations.notifications.label.mnda.expired": { en: "MNDA expired" },
  "operations.notifications.label.contract.approval_requested": {
    en: "Contract approval requested",
  },
  "operations.notifications.label.contract.approved": {
    en: "Contract approved",
  },
  "operations.notifications.label.contract.sent_back": {
    en: "Contract sent back",
  },
  "operations.notifications.label.contract.counterparty_signed": {
    en: "Contract signed by the counterparty",
  },
  "operations.notifications.label.contract.executed": {
    en: "Contract executed",
  },
  "operations.notifications.label.contract.attention": {
    en: "Contract needs attention",
  },
  "operations.notifications.label.contract.declined": {
    en: "Contract declined",
  },
  "operations.notifications.label.contract.expired": {
    en: "Contract expired",
  },
  "operations.notifications.label.handoff.requested": {
    en: "Handoff requested",
  },
  "operations.notifications.label.handoff.in_progress": {
    en: "Handoff in progress",
  },
  "operations.notifications.label.handoff.done": { en: "Handoff done" },
  "operations.notifications.label.handoff.declined": {
    en: "Handoff declined",
  },
  "operations.notifications.label.capability.approval_requested": {
    en: "Capability approval requested",
  },
  "operations.notifications.label.capability.approved": {
    en: "Capability approved",
  },
  "operations.notifications.label.capability.rejected": {
    en: "Capability rejected",
  },
  "operations.notifications.label.price_book.approval_requested": {
    en: "Price book approval requested",
  },
  "operations.notifications.label.price_book.approved": {
    en: "Price book activated",
  },
  "operations.notifications.label.price_book.rejected": {
    en: "Price book rejected",
  },

  "operations.notifications.group.mnda": { en: "MNDAs" },
  "operations.notifications.group.contract": { en: "Contracts" },
  "operations.notifications.group.handoff": { en: "Handoffs" },
  "operations.notifications.group.capability": { en: "Capabilities" },
  "operations.notifications.group.price_book": { en: "Price books" },

  "operations.notifications.preferences.title": { en: "Email" },
  "operations.notifications.preferences.description": {
    en: "Every notification shows here. Email is extra, and you choose what it carries.",
  },
  "operations.notifications.preferences.channelOff": {
    en: "Commerce is not sending notification email yet. Your choices apply once it does.",
  },
  "operations.notifications.preferences.emailEnabled": {
    en: "Email me my notifications",
  },
  "operations.notifications.preferences.emailEnabledHelp": {
    en: "Sent to {email}.",
  },
  "operations.notifications.preferences.kinds": {
    en: "Email me about",
  },
  "operations.notifications.preferences.saved": {
    en: "Email preferences saved.",
  },

  "operations.notifications.settings.title": {
    en: "Notification settings",
  },
  "operations.notifications.settings.description": {
    en: "Every staff member sees their notifications in Commerce. Email and Slack are optional and apply to everyone.",
  },
  "operations.notifications.settings.back": { en: "Back to notifications" },
  "operations.notifications.settings.email": { en: "Email" },
  "operations.notifications.settings.slack": { en: "Slack" },
  "operations.notifications.settings.configured": { en: "Connected" },
  "operations.notifications.settings.notConfigured": {
    en: "Not configured",
  },
  "operations.notifications.settings.invalid": {
    en: "Configured incorrectly",
  },
  "operations.notifications.settings.demoChannel": { en: "Off in the demo" },
  "operations.notifications.settings.emailSender": {
    en: "Sent from {sender}.",
  },
  "operations.notifications.settings.emailMissing": {
    en: "Email needs a verified sender in the deployment. The notifications runbook lists the steps.",
  },
  "operations.notifications.settings.slackMissing": {
    en: "Slack needs an incoming webhook in the deployment. The notifications runbook lists the steps.",
  },
  "operations.notifications.settings.invalidHelp": {
    en: "The deployment's setting is not usable. Check it against the notifications runbook.",
  },
  "operations.notifications.settings.emailEnabled": {
    en: "Send notifications by email",
  },
  "operations.notifications.settings.emailEnabledHelp": {
    en: "Each person can still turn email off or choose kinds for themselves.",
  },
  "operations.notifications.settings.emailKinds": {
    en: "Kinds sent by email",
  },
  "operations.notifications.settings.slackEnabled": {
    en: "Post to Slack",
  },
  "operations.notifications.settings.slackEnabledHelp": {
    en: "One line per change: the record type, its status, the counterparty and a link. Notes and amounts are never posted.",
  },
  "operations.notifications.settings.slackKinds": {
    en: "Kinds posted to Slack",
  },
  "operations.notifications.settings.slackChannel": {
    en: "Slack channel",
  },
  "operations.notifications.settings.slackChannelHelp": {
    en: "The name of the channel the webhook posts to, such as #revenue. Shown here only; the webhook decides the channel.",
  },
  "operations.notifications.settings.notConfiguredWarning": {
    en: "This channel is on but not configured, so nothing is sent until the deployment supplies it.",
  },
  "operations.notifications.settings.sendTest": { en: "Send a test" },
  "operations.notifications.settings.testEmailSent": {
    en: "Test email sent to {email}.",
  },
  "operations.notifications.settings.testSlackSent": {
    en: "Test message posted to Slack.",
  },
  "operations.notifications.settings.testFailed": {
    en: "The test was not delivered ({code}).",
  },
  "operations.notifications.settings.saved": {
    en: "Notification settings saved.",
  },
  "operations.notifications.settings.conflict": {
    en: "Someone else saved these settings first. Their version is shown; make your change again.",
  },
  "operations.notifications.settings.lastChanged": { en: "Last changed" },
  "operations.notifications.settings.outcome": { en: "{status} ({reason})" },
  "operations.notifications.settings.recent": {
    en: "Recent deliveries",
  },
  "operations.notifications.settings.recentEmpty": {
    en: "No email or Slack delivery has been attempted yet.",
  },
  "operations.notifications.settings.recentChannel": { en: "Channel" },
  "operations.notifications.settings.recentKind": { en: "Kind" },
  "operations.notifications.settings.recentStatus": { en: "Result" },
  "operations.notifications.settings.recentWhen": { en: "When" },
  "operations.notifications.settings.status.sending": {
    en: "Not confirmed",
  },
  "operations.notifications.settings.status.sent": { en: "Sent" },
  "operations.notifications.settings.status.skipped": { en: "Skipped" },
  "operations.notifications.settings.status.failed": { en: "Failed" },
  "operations.notifications.settings.reason.not_configured": {
    en: "not configured",
  },
  "operations.notifications.settings.reason.invalid_configuration": {
    en: "configured incorrectly",
  },
  "operations.notifications.settings.reason.channel_off": {
    en: "channel off",
  },
  "operations.notifications.settings.reason.kind_off": { en: "kind off" },
  "operations.notifications.settings.reason.preference_off": {
    en: "recipient turned it off",
  },
  "operations.notifications.settings.reason.no_access": {
    en: "recipient no longer has access",
  },
  "operations.notifications.settings.reason.demo": { en: "demo" },
  "operations.notifications.settings.reason.provider_rejected": {
    en: "refused by the provider",
  },
  "operations.notifications.settings.reason.provider_unavailable": {
    en: "provider unavailable, retrying",
  },
  "operations.notifications.settings.reason.gave_up": {
    en: "provider unavailable, retries spent",
  },
  "operations.notifications.settings.outcomeWithCode": {
    en: "{status} ({reason}: {code})",
  },
  "operations.notifications.settings.demo": {
    en: "The demo shows these settings read-only and never sends.",
  },
});
