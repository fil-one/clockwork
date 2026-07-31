import type { Money } from "@clockwork/contracts";

import type { PricedQuoteLine } from "../pricing";

export type CommercialRoute =
  "direct" | "referral" | "resale" | "distributor" | "marketplace";

export interface WhiteLabelMetadata {
  displayName: string;
  logoDocumentId?: string;
  accentColor?: string;
  commercialContactEmail: string;
  footer?: string;
}

export interface QuoteSnapshot {
  id: string;
  seriesId: string;
  revision: number;
  previousRevisionId?: string;
  accountId: string;
  endClientAccountId?: string;
  partnerAccountId?: string;
  priceBook: { id: string; version: number };
  route: CommercialRoute;
  status:
    "draft" | "issued" | "accepted" | "expired" | "superseded" | "rejected";
  lines: readonly PricedQuoteLine[];
  total: Money;
  partnerResaleTotal?: Money;
  marginResult:
    "not_configured" | "pass" | "exception_required" | "approved" | "rejected";
  exceptionReasons: readonly string[];
  exceptionDecision?: { actorId: string; reason: string; decidedAt: string };
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  issuedAt?: string;
  immutableSnapshot?: string;
  renderedDocumentId?: string;
  partnerDocumentId?: string;
  whiteLabel?: WhiteLabelMetadata;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function validateShape(quote: QuoteSnapshot): void {
  const partnerRoute =
    quote.route === "referral" ||
    quote.route === "resale" ||
    quote.route === "distributor";
  if (partnerRoute && (!quote.partnerAccountId || !quote.endClientAccountId))
    throw new Error(
      "Partner quotes require both partner and named end-client accounts",
    );
  if (!partnerRoute && (quote.partnerAccountId || quote.endClientAccountId))
    throw new Error(
      "Direct and marketplace quotes cannot carry partner relationship identifiers",
    );
  if (
    (quote.route === "resale" || quote.route === "distributor") !==
    Boolean(quote.partnerResaleTotal)
  )
    throw new Error(
      "Resale/distributor quotes require a partner-controlled resale total only on those routes",
    );
  if (
    quote.whiteLabel &&
    quote.route !== "resale" &&
    quote.route !== "distributor"
  )
    throw new Error(
      "White-label commercial metadata is restricted to resale shapes",
    );
  if (quote.lines.length === 0)
    throw new Error("Quote must contain priced lines");
  if (
    quote.lines.some((line) => line.lineTotal.currency !== quote.total.currency)
  )
    throw new Error("Quote line currencies must match quote currency");
}

export function createQuoteDraft(
  input: Omit<QuoteSnapshot, "status" | "revision" | "createdAt"> & {
    revision?: number;
    createdAt: string;
  },
): QuoteSnapshot {
  const quote: QuoteSnapshot = {
    ...input,
    revision: input.revision ?? 1,
    status: "draft",
  };
  if (!Number.isInteger(quote.revision) || quote.revision < 1)
    throw new Error("Quote revision must be positive");
  if (Date.parse(quote.expiresAt) <= Date.parse(quote.createdAt))
    throw new Error("Quote expiry must follow creation");
  validateShape(quote);
  return quote;
}

export function approveQuoteException(
  quote: QuoteSnapshot,
  decision: {
    approved: boolean;
    actorId: string;
    reason: string;
    decidedAt: string;
  },
): QuoteSnapshot {
  if (quote.status !== "draft" || quote.marginResult !== "exception_required")
    throw new Error(
      "Only a draft with a required pricing exception can be decided",
    );
  if (!decision.reason.trim())
    throw new Error("Pricing exception decision requires a reason");
  return {
    ...quote,
    marginResult: decision.approved ? "approved" : "rejected",
    exceptionDecision: {
      actorId: decision.actorId,
      reason: decision.reason,
      decidedAt: decision.decidedAt,
    },
    status: decision.approved ? "draft" : "rejected",
  };
}

export function issueQuote(
  quote: QuoteSnapshot,
  evidence: {
    issuedAt: string;
    renderedDocumentId: string;
    partnerDocumentId?: string;
  },
): QuoteSnapshot {
  if (quote.status !== "draft")
    throw new Error("Only a draft quote can be issued");
  if (
    quote.marginResult === "exception_required" ||
    quote.marginResult === "rejected"
  )
    throw new Error("Pricing exception approval is required before issuance");
  if (Date.parse(quote.expiresAt) <= Date.parse(evidence.issuedAt))
    throw new Error("An expired quote cannot be issued");
  if (
    (quote.route === "resale" || quote.route === "distributor") &&
    !evidence.partnerDocumentId
  )
    throw new Error(
      "Resale quote issuance requires the partner-priced artifact",
    );
  const snapshotSource = {
    id: quote.id,
    seriesId: quote.seriesId,
    revision: quote.revision,
    accountId: quote.accountId,
    endClientAccountId: quote.endClientAccountId,
    partnerAccountId: quote.partnerAccountId,
    priceBook: quote.priceBook,
    route: quote.route,
    lines: quote.lines,
    total: quote.total,
    partnerResaleTotal: quote.partnerResaleTotal,
    marginResult: quote.marginResult,
    expiresAt: quote.expiresAt,
    whiteLabel: quote.whiteLabel,
  };
  return Object.freeze({
    ...quote,
    status: "issued",
    issuedAt: evidence.issuedAt,
    renderedDocumentId: evidence.renderedDocumentId,
    ...(evidence.partnerDocumentId
      ? { partnerDocumentId: evidence.partnerDocumentId }
      : {}),
    immutableSnapshot: stable(snapshotSource),
    lines: Object.freeze([...quote.lines]),
    exceptionReasons: Object.freeze([...quote.exceptionReasons]),
  });
}

export function reviseQuote(
  prior: QuoteSnapshot,
  input: Omit<
    QuoteSnapshot,
    "seriesId" | "revision" | "previousRevisionId" | "status" | "createdAt"
  > & {
    createdAt: string;
  },
): { prior: QuoteSnapshot; revision: QuoteSnapshot } {
  if (
    prior.status !== "issued" &&
    prior.status !== "expired" &&
    prior.status !== "rejected"
  )
    throw new Error("Only a terminal or issued quote can be revised");
  const revision = createQuoteDraft({
    ...input,
    seriesId: prior.seriesId,
    revision: prior.revision + 1,
    previousRevisionId: prior.id,
  });
  return {
    prior:
      prior.status === "issued" ? { ...prior, status: "superseded" } : prior,
    revision,
  };
}

export function expireQuote(quote: QuoteSnapshot, now: string): QuoteSnapshot {
  if (quote.status !== "issued") return quote;
  return Date.parse(now) >= Date.parse(quote.expiresAt)
    ? { ...quote, status: "expired" }
    : quote;
}

export function assertQuoteSnapshotUnchanged(quote: QuoteSnapshot): void {
  if (!quote.immutableSnapshot)
    throw new Error("Quote has no immutable issuance snapshot");
  const current = stable({
    id: quote.id,
    seriesId: quote.seriesId,
    revision: quote.revision,
    accountId: quote.accountId,
    endClientAccountId: quote.endClientAccountId,
    partnerAccountId: quote.partnerAccountId,
    priceBook: quote.priceBook,
    route: quote.route,
    lines: quote.lines,
    total: quote.total,
    partnerResaleTotal: quote.partnerResaleTotal,
    marginResult: quote.marginResult,
    expiresAt: quote.expiresAt,
    whiteLabel: quote.whiteLabel,
  });
  if (current !== quote.immutableSnapshot)
    throw new Error("Issued quote snapshot was mutated");
}
