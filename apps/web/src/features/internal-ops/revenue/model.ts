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

export function formatMinor(minor: string, currency: string): string {
  const negative = minor.startsWith("-");
  const digits = (negative ? minor.slice(1) : minor).padStart(3, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)} ${currency}`;
}

export function stageLabel(stage: ForecastStage): string {
  return stage === "committed_backlog" ? "Contracted backlog" : "Pipeline";
}

export function basisLabel(basis: string): string {
  return basis === "transfer_price"
    ? "Transfer price — partner-retained-margin basis, not gross"
    : basis === "gross"
      ? "Gross"
      : basis;
}
