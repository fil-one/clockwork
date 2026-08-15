export { adminSafetyCopy } from "./administration-safety/copy";
export { lifecycleCopy } from "./finance-lifecycle/copy";
export { QUEUE_COPY, SEARCH_COPY } from "./queue-search/copy";

export const internalOpsCopy = {
  home: {
    eyebrow: "Internal operations",
    title: "Operational health",
    description:
      "What each operator channel returned for this session, counted from the read rather than described.",
    generated: "Newest projection generated",
    staleSuffix: "stale",
    stale: (channels: string) =>
      `At least one record is past its refresh window in: ${channels}. Verify anything you act on against the source record.`,
    healthHeading: "Channel signals",
    healthDescription:
      "One row per operator channel: what it holds, when it was generated, and where to act on it.",
    tableLabel: "Operator channel signals",
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
