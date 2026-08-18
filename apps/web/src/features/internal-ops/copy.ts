export { adminSafetyCopy } from "./administration-safety/copy";
export { lifecycleCopy } from "./finance-lifecycle/copy";
export { QUEUE_COPY, SEARCH_COPY } from "./queue-search/copy";

export const internalOpsCopy = {
  home: {
    eyebrow: "Internal operations",
    title: "Operational health",
    description:
      "The work that needs attention across approvals, collections, provisioning, renewals, and reporting.",
    generated: "Updated",
    staleSuffix: "stale",
    stale: (channels: string) =>
      `Refresh needed for ${channels}. Open the workspace before making a decision.`,
    healthHeading: "Work overview",
    healthDescription:
      "Prioritized work across the teams you support, with a direct path to each workspace.",
    tableLabel: "Operational work overview",
    openQueue: "Open my queue",
  },
  assisted: {
    label: "Assisted mode active",
    effectiveAccount: "Effective account",
    account: "Northstar Archive Labs",
    staffActor: "Staff actor",
    actor: "Morgan Ellis · Internal operator",
    reasonLabel: "Reason",
    reason: "Customer-requested quote correction · CASE-4812",
    authority:
      "Actor authority comes from the server session and cannot be changed here.",
    exit: "Review exit",
  },
} as const;
