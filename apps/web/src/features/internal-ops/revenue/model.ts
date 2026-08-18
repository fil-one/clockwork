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

export function businessLabel(value: string): string {
  const [name, version] = value.split(".", 2);
  const label = (name ?? value)
    .replaceAll("_", " ")
    .replace(/^\w/u, (letter) => letter.toUpperCase());
  return version ? `${label} · ${version}` : label;
}

export function monthLabel(value: string): string {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
