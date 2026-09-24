import type { MessageId, Translator } from "@/src/i18n";

export type ForecastStage = "committed_backlog" | "pipeline";

export interface StageRevenue {
  stage: ForecastStage;
  currency: string;
  revenueBasis: string;
  revenueMinor: string;
  quoteCount: number;
  orderCount: number;
}

export interface ChannelRevenue {
  channel: string;
  merchantOfRecord: string;
  currency: string;
  revenueBasis: string;
  revenueMinor: string;
  orderCount: number;
}

export interface MonthlyRevenue {
  month: string;
  currency: string;
  revenueBasis: string;
  revenueMinor: string;
  orderCount: number;
}

export interface RecurringRevenue {
  currency: string;
  revenueBasis: string;
  methodologyVersion: string;
  mrrMinor: string;
  arrMinor: string;
  contractCount: number;
}

export interface RevenueWorkspace {
  stages: readonly StageRevenue[];
  channels: readonly ChannelRevenue[];
  months: readonly MonthlyRevenue[];
  recurring: readonly RecurringRevenue[];
  forecastRowCount: number;
  remainingBacklogRowCount: number;
  recurringContractCount: number;
  source: string;
  readable: boolean;
}

/**
 * Where a workspace's rows were read from. It is recorded on the workspace for
 * diagnostics and tests; no surface renders it, so it is not interface text.
 */
export const revenueSources = {
  live: "core_revenue_forecast and core_arr_mrr", // i18n-exempt: provenance source name (the two reporting views), never rendered
  unavailable: "No revenue reporting read is available", // i18n-exempt: provenance source name, never rendered
  demo: "Demonstration commerce reporting ledger", // i18n-exempt: provenance source name, never rendered
} as const;

export function stageLabel(stage: ForecastStage, t: Translator): string {
  return t(
    stage === "committed_backlog"
      ? "operations.finance.revenue.stage.committedBacklog"
      : "operations.finance.revenue.stage.pipeline",
  );
}

const basisMessages: Readonly<Record<string, MessageId>> = {
  gross: "operations.finance.revenue.basis.gross",
  transfer_price: "operations.finance.revenue.basis.transferPrice",
};

/** The revenue basis, which says whose gross the amount is. */
export function basisLabel(basis: string, t: Translator): string {
  const id = basisMessages[basis];
  return id ? t(id) : basis;
}

const merchantMessages: Readonly<Record<string, MessageId>> = {
  fil_one: "operations.finance.revenue.merchant.filOne",
  partner: "operations.finance.revenue.merchant.partner",
  marketplace: "operations.finance.revenue.merchant.marketplace",
};

/** `orders.merchant_of_record`: `fil_one`, `partner` or `marketplace`. */
export function merchantLabel(value: string, t: Translator): string {
  const id = merchantMessages[value];
  return id ? t(id) : value;
}

const methodologyMessages: Readonly<Record<string, MessageId>> = {
  merchant_of_record: "operations.finance.revenue.methodology.merchantOfRecord",
};

/**
 * `<rule>.<version>` as the view states it (`merchant_of_record.v1`): the rule
 * worded, the version kept as written. An unknown rule is shown as recorded.
 */
export function methodologyLabel(value: string, t: Translator): string {
  const [name, version] = value.split(".", 2);
  const id = name ? methodologyMessages[name] : undefined;
  if (!id) return value;
  return version
    ? t("common.join.labels", { first: t(id), second: version })
    : t(id);
}

export function monthLabel(value: string, locale: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
