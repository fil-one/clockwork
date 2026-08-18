export const webhookReplayCopy = {
  title: "Stopped provider callbacks",
  description:
    "Provider callbacks that failed or have not been processed. Replay re-runs one from the bytes verified when the provider delivered it.",

  freshnessReadable: "Read at page load",
  freshnessUnreadable: "No read completed for this request",
  sourceReadable: "Verified provider callbacks",
  sourceDemo: "Demonstration verified callback ledger",
  sourceUnreadable: "No callback read is available",

  unreadableTitle: "The callback store could not be read.",
  unreadableBody:
    "This page is showing nothing because no read completed, which is a different state from having no stopped callbacks. Check the service database connection before concluding every callback landed.",

  sectionHeading: "Stopped callbacks",
  sectionHint: "Provider, event, failure, and how many times it was attempted.",
  empty:
    "No callback is stopped. Every verified event either processed or is still within its delivery attempts.",

  columns: {
    provider: "Provider",
    callback: "Callback",
    eventType: "Type",
    state: "State",
    received: "Received",
    attempts: "Attempts",
    failure: "Last error",
    decision: "Decision",
  },

  stateLabel: {
    failed: "Failed",
    unprocessed: "Not processed",
    processed: "Processed",
  },

  noError: "Not recorded",

  action: "Replay",
  confirmAccept: "Replay this callback",
  pending: "Replaying…",

  effect:
    "The stored event is processed again from the bytes verified at delivery. A corrected payload cannot be picked up here; ask the provider to redeliver the event for that.",
  repeatSubmission:
    "One. A second submission reports the run already in flight and starts nothing.",

  detail: {
    callback: "Callback",
    eventType: "Type",
    payloadHash: "Payload hash",
    repeatSubmission: "Replays started by submitting twice",
  },

  tableCaption:
    "Stopped provider callbacks with their failure and the replay available",

  reasonLabel: "Reason",
  reasonHelp:
    "At least 8 characters. Give the incident or ticket reference and why replay is safe. Kept with your name on the audit record.",

  outcome: {
    started: "Replay started.",
    alreadyRunning:
      "A replay for this callback is already running. Nothing new was started.",
    reasonRequired: "Give a reason of at least 8 characters.",
    recentAuthRequired:
      "Sign in again to confirm it is you, then repeat the replay.",
    forbidden: "Your permission to replay provider callbacks has changed.",
    notFound: "No verified callback matches this provider and event id.",
    unavailable: "The callback store cannot be reached.",
    failed: "The replay could not be started. Nothing changed.",
  },
} as const;
