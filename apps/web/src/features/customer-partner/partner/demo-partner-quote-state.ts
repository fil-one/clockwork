import type { PartnerRecord } from "./partner-data";

export interface StoredQuote {
  readonly kind: "demo_partner_quote";
  readonly aggregateId: string;
  readonly partnerAccountId: string;
  readonly record: PartnerRecord;
  readonly createdAt: string;
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly orderId?: string;
  readonly clientResponse?: {
    decision: string;
    name: string;
    note: string;
    at: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isStoredQuote(value: unknown): value is StoredQuote {
  return (
    isRecord(value) &&
    value.kind === "demo_partner_quote" &&
    typeof value.aggregateId === "string" &&
    typeof value.partnerAccountId === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.record) &&
    typeof value.record.id === "string" &&
    isRecord(value.snapshot)
  );
}
