/**
 * Message IDs for the revenue and channel surface. The wording lives in
 * `src/i18n/messages/operations-finance.ts` in every interface language; this
 * map only says which message each part of the page shows.
 */
export const revenueCopy = {
  page: {
    title: "operations.finance.revenue.title",
    description: "operations.finance.revenue.description",
  },
  summary: {
    label: "operations.finance.revenue.summaryLabel",
    forecast: {
      title: "operations.finance.revenue.summary.forecast",
      detail: "operations.finance.revenue.summary.forecast.detail",
    },
    remaining: {
      title: "operations.finance.revenue.summary.remaining",
      detail: "operations.finance.revenue.summary.remaining.detail",
    },
    recurring: {
      title: "operations.finance.revenue.summary.recurring",
      detail: "operations.finance.revenue.summary.recurring.detail",
    },
  },
  unreadable: {
    title: "operations.finance.revenue.unreadable",
    detail: "operations.finance.revenue.unreadable.detail",
  },
  groups: "operations.finance.revenue.groups",
  stage: {
    heading: "operations.finance.revenue.stage.heading",
    subheading: "operations.finance.revenue.stage.subheading",
    caption: "operations.finance.revenue.stage.caption",
    empty: "operations.finance.revenue.stage.empty",
    columns: [
      "operations.finance.revenue.column.stage",
      "common.currency",
      "operations.finance.revenue.column.basis",
      "common.amount",
      "operations.finance.revenue.column.quotes",
      "operations.finance.revenue.column.orders",
    ],
  },
  channel: {
    heading: "operations.finance.revenue.route.heading",
    subheading: "operations.finance.revenue.route.subheading",
    caption: "operations.finance.revenue.route.caption",
    empty: "operations.finance.revenue.route.empty",
    columns: [
      "operations.finance.column.route",
      "operations.finance.revenue.column.merchant",
      "common.currency",
      "operations.finance.revenue.column.basis",
      "common.amount",
      "operations.finance.revenue.column.orders",
    ],
  },
  monthly: {
    heading: "operations.finance.revenue.monthly.heading",
    subheading: "operations.finance.revenue.monthly.subheading",
    caption: "operations.finance.revenue.monthly.caption",
    empty: "operations.finance.revenue.monthly.empty",
    columns: [
      "operations.finance.revenue.column.month",
      "common.currency",
      "operations.finance.revenue.column.basis",
      "common.amount",
      "operations.finance.revenue.column.orders",
    ],
  },
  recurring: {
    heading: "operations.finance.report.arrMrr",
    subheading: "operations.finance.revenue.recurring.subheading",
    caption: "operations.finance.revenue.recurring.caption",
    empty: "operations.finance.revenue.recurring.empty",
    columns: [
      "common.currency",
      "operations.finance.revenue.column.basis",
      "operations.finance.revenue.column.mrr",
      "operations.finance.revenue.column.arr",
      "operations.finance.revenue.column.contracts",
      "operations.finance.revenue.column.methodology",
    ],
  },
} as const;
