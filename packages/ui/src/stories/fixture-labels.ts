/**
 * English words for the kit's own stories and unit tests.
 *
 * The kit carries no default words (an English default is how a translated
 * screen ends up half English), so every harness that renders a component
 * supplies them. This file is that harness text. It is not exported from the
 * package and no application imports it: the web app passes its catalog's
 * words for the reader's language instead.
 */
import type {
  CommandPaletteLabels,
  KitText,
  RenewalState,
  TermBarMessages,
} from "../index";

export const fixtureKitText: KitText = {
  close: "Close",
  search: "Search",
  noMatches: "No matches",
  loading: "Loading",
};

export const fixtureShellLabels = {
  bannerLabel: "Application status",
  skipLabel: "Skip to main content",
  navigationLabel: "Primary",
  mobileNavigationLabel: "Open navigation",
  mobileNavigationTitle: "Navigation",
  mobileNavigationDescription: "Browse every destination.",
  mobileNavigationCloseLabel: "Close navigation",
} as const;

export const fixtureDrawerLabels = {
  label: "Primary",
  triggerLabel: "Open navigation",
  title: "Navigation",
  description: "Browse every destination.",
  closeLabel: "Close navigation",
} as const;

export const fixtureCommandPaletteLabels: CommandPaletteLabels = {
  title: "Search and commands",
  description: "Search navigation, common actions, and records.",
  closeLabel: "Close command palette",
  searchLabel: "Search navigation, actions, and records",
  placeholder: "Search navigation, actions, and records",
  noResultsTitle: "No results",
  noResultsLabel: "No matching commands. Try a different search.",
  groupLabels: {
    navigation: "Navigation",
    actions: "Actions",
    records: "Records",
  },
  keyHints: { move: "Move", select: "Select", close: "Close" },
};

export const fixtureToolbarLabels = {
  label: "Collection controls",
  searchLabel: "Search collection",
  searchPlaceholder: "Search",
  loadingLabel: "Updating results",
  resultLabel: (count: number) =>
    `${count} ${count === 1 ? "result" : "results"}`,
} as const;

const renewalStates: Readonly<Record<RenewalState, string>> = {
  "auto-renews": "Automatic renewal",
  evergreen: "Evergreen term",
  "notice-open": "Notice window open",
  "non-renewing": "Will not renew",
  renewed: "Renewed",
  expired: "Expired",
};

export const fixtureTermBarMessages: TermBarMessages = {
  elapsed: (percent, days) => `${percent} elapsed, ${days} days since start`,
  remaining: (days) => `${days} days remaining`,
  endDate: (date) => `Term ends ${date}`,
  endsOn: { before: "Ends ", after: "" },
  noticeWindow: (start, end) => `Notice window ${start} through ${end}`,
  renewalState: (state) => renewalStates[state],
  sentences: (parts) => parts.join(". "),
};

export const fixtureTermRollupLabels = {
  termCountLabel: (count: number) =>
    `${count} active ${count === 1 ? "term" : "terms"}`,
  nextEndLabel: "Next end date",
  noTermsLabel: "No active terms",
} as const;

export const fixtureChartLabels = {
  locale: "en-US",
  emptyLabel: "No chart data",
  tableLabel: "View data table",
  periodLabel: "Period",
  valueLabel: "Value",
  formatPoint: (label: string, value: string) => `${label}: ${value}`,
} as const;

export const fixtureDocumentMetaLabels = {
  documentId: "Document ID",
  version: "Version",
  updated: "Updated",
} as const;

export const fixtureErrorMessages = {
  title: "Something went wrong",
  description:
    "Reference the request ID in the page footer when contacting support.",
  retry: "Try again",
} as const;
