export const revenueCopy = {
  page: {
    title: "Revenue & channel",
    description:
      "Contracted backlog, unaccepted quote pipeline, channel basis, and recurring run rate from the reporting views.",
  },
  source: {
    live: "core_revenue_forecast and core_arr_mrr",
    unavailable: "No revenue reporting read is available",
  },
  summary: {
    label: "Revenue report coverage",
    forecast: {
      title: "Forecast rows",
      detail: "Quotes and orders included in the current forecast",
    },
    remaining: {
      title: "Remaining backlog rows",
      detail: "Committed rows dated this month or later",
    },
    recurring: {
      title: "Recurring contracts",
      detail: "Active contracts included in ARR and MRR",
    },
  },
  unreadable: {
    title: "Revenue reporting could not be read.",
    detail:
      "No figures are shown because no read completed. This is not a zero-revenue report.",
  },
  methodology: {
    title: "How to read the money",
    detail:
      "Amounts stay separated by currency and revenue basis. Pipeline is the full issued quote amount and is not probability-weighted. Transfer price means the partner is merchant of record: it is the Fil One retained basis, not end-client gross revenue.",
  },
  stage: {
    heading: "Forecast by stage",
    subheading:
      "Contracted backlog and unaccepted quote pipeline. Pipeline shows full issued value and is not probability-weighted.",
    caption: "Forecast totals by stage, currency, and revenue basis",
    empty: "No forecast rows were returned.",
    columns: [
      "Stage",
      "Currency",
      "Revenue basis",
      "Amount",
      "Quotes",
      "Orders",
    ],
  },
  channel: {
    heading: "Remaining backlog by channel",
    subheading:
      "Committed rows whose forecast month is this month or later; historical forecast months are excluded.",
    caption: "Remaining committed backlog by channel and money basis",
    empty: "No remaining committed backlog rows were returned.",
    columns: [
      "Channel",
      "Merchant of record",
      "Currency",
      "Revenue basis",
      "Amount",
      "Orders",
    ],
  },
  monthly: {
    heading: "Twelve-month committed schedule",
    subheading:
      "This month plus the next eleven calendar months, without pipeline.",
    caption: "Committed revenue scheduled for the next twelve months",
    empty: "No committed revenue falls in the next twelve months.",
    columns: ["Month", "Currency", "Revenue basis", "Amount", "Orders"],
  },
  recurring: {
    heading: "ARR & MRR",
    subheading:
      "Contracted run rate by currency, merchant-of-record basis, and methodology version.",
    caption: "Contracted recurring value by currency and methodology",
    empty: "No contracted recurring run-rate rows were returned.",
    columns: [
      "Currency",
      "Revenue basis",
      "MRR",
      "ARR",
      "Contracts",
      "Methodology",
    ],
  },
} as const;
