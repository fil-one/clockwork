export const integrationStatusCopy = {
  page: {
    title: "Integration status",
    description:
      "Configuration reported by each generated service status endpoint, plus the stopped work already recorded in the recovery queues.",
  },
  source: "dead-letter and webhook replay read models",
  sourceUnavailable: "One or more operational queue reads are unavailable",
  queues: {
    label: "Stopped work coverage",
    dispatch: "Dispatch failures",
    provisioning: "Provisioning failures",
    workflow: "Workflow failures",
    webhook: "Webhook callbacks",
    denominator: "Counted within the first 100 records read from each queue",
    unreadable:
      "At least one queue could not be read. A zero on this page is not evidence that the unreadable queue is empty.",
    recoveryLink: "Open recovery",
    webhookLink: "Open webhook replay",
  },
  lanes: {
    heading: "Service configuration",
    detail:
      "Fetched from /v1/core/status, /v1/lifecycle/status, and /v1/system/status through this application origin.",
    loading: "Reading service status…",
    unavailable: "This status endpoint did not return a readable result.",
    readAt: (instant: string) => `Read at ${instant} in this page load`,
  },
} as const;
