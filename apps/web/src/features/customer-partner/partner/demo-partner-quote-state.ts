import type { Route } from "next";

import type { PartnerRecord, PartnerRisk, PartnerStatus } from "./partner-data";

/**
 * What a demo partner quote keeps about itself in the demo state store, next to
 * the pricing snapshot. Facts only: identifiers, the record's state, and the
 * words a person typed (a withdrawal reason). Amounts, dates and every label
 * are derived from the snapshot when a reader opens the quote, in that
 * reader's language.
 *
 * State written before this shape also carried `context`, `owner`, `value`,
 * `secondary`, `quotePricing` and document `label`s, rendered once in English.
 * Those keys may still be present in a stored quote; nothing reads them except
 * the two legacy fallbacks in `demo-partner-quote.ts`, and every write drops
 * them (see `storedQuoteFacts`).
 */
export interface StoredQuoteRecord {
  readonly id: string;
  /** "{end client} · {SKU}": a name and a code, no prose. */
  readonly name: string;
  readonly status: PartnerStatus;
  readonly risk: PartnerRisk;
  readonly recordVersion?: number;
  readonly recordKey?: string;
  readonly href?: Route;
  readonly allowedActions?: readonly string[];
  readonly documents?: NonNullable<PartnerRecord["documents"]>;
  /** Set on the prior quote when a revision replaces it. */
  readonly supersededByRevision?: number;
  /** What the partner typed when withdrawing the quote. */
  readonly withdrawalReason?: string;
}

export interface StoredQuote {
  readonly kind: "demo_partner_quote";
  readonly aggregateId: string;
  readonly partnerAccountId: string;
  readonly record: StoredQuoteRecord;
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

/**
 * The fact fields of a stored record, dropping anything a writer before the
 * facts-only shape rendered into it. Every writer builds its next record from
 * this, so an old record's English never travels forward into a new write.
 */
export function storedQuoteFacts(record: StoredQuoteRecord): StoredQuoteRecord {
  const {
    id,
    name,
    status,
    risk,
    recordVersion,
    recordKey,
    href,
    allowedActions,
    documents,
    supersededByRevision,
    withdrawalReason,
  } = record;
  return {
    id,
    name,
    status,
    risk,
    ...(recordVersion === undefined ? {} : { recordVersion }),
    ...(recordKey === undefined ? {} : { recordKey }),
    ...(href === undefined ? {} : { href }),
    ...(allowedActions === undefined ? {} : { allowedActions }),
    ...(documents === undefined
      ? {}
      : { documents: documents.map(({ id, kind }) => ({ id, kind })) }),
    ...(supersededByRevision === undefined ? {} : { supersededByRevision }),
    ...(withdrawalReason === undefined ? {} : { withdrawalReason }),
  };
}
