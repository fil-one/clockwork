export const integrationStatusCopy = {
  page: {
    title: "Integration status",
    description:
      "Availability of commerce services and any stopped integration work that needs attention.",
  },
  source: "recovery and webhook processing queues",
  sourceUnavailable: "One or more operational queue reads are unavailable",
  queues: {
    label: "Stopped work coverage",
    dispatch: "Dispatch failures",
    provisioning: "Provisioning failures",
    workflow: "Workflow failures",
    webhook: "Webhook callbacks",
    denominator: "Items currently waiting for operator attention",
    unreadable:
      "At least one queue could not be read. A zero on this page is not evidence that the unreadable queue is empty.",
    recoveryLink: "Open recovery",
    webhookLink: "Open webhook replay",
  },
  lanes: {
    heading: "Service configuration",
    detail:
      "Current availability of core commerce, lifecycle, and system services.",
    loading: "Reading service status…",
    unavailable: "This service status check did not return a readable result.",
    readAt: (instant: string) => `Updated ${instant}`,
  },
} as const;
