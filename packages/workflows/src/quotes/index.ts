import {
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const quoteTaskIds = Object.freeze({
  expiryAlerts: "lifecycle-quotes-expiry-alerts-v1",
});

export type QuoteEffect = WorkflowEffect<
  "send_quote_expiry_alert",
  Readonly<Record<string, unknown>>
>;

export interface QuoteExpiryClock {
  quoteId: string;
  accountId: string;
  version: number;
  status: string;
  expiresAt: string;
}

function quoteIdentity(quote: QuoteExpiryClock): WorkflowIdentity {
  return {
    aggregateType: "quote",
    aggregateId: quote.quoteId,
    aggregateVersion: quote.version,
    operation: "quote-expiry",
  };
}

/**
 * A quote's contractual expiry is the boundary the alert fires on. Nothing is
 * inferred about how far ahead a warning should go out; that lead time is a
 * commercial policy input the platform does not hold.
 */
export function planQuoteExpiryAlert(input: {
  quote: QuoteExpiryClock;
  now: string;
  recipients: readonly string[];
}): readonly QuoteEffect[] {
  const now = Date.parse(input.now);
  const expiresAt = Date.parse(input.quote.expiresAt);
  if (!Number.isFinite(now)) throw new Error("NOW_INVALID");
  if (!Number.isFinite(expiresAt)) throw new Error("QUOTE_EXPIRY_INVALID");
  if (input.quote.status !== "issued") return [];
  if (now < expiresAt) return [];
  if (input.recipients.length === 0)
    throw new Error("QUOTE_ALERT_RECIPIENT_REQUIRED");
  return [
    workflowEffect(
      quoteIdentity(input.quote),
      `expiry:${input.quote.expiresAt}`,
      "send_quote_expiry_alert",
      {
        quoteId: input.quote.quoteId,
        expiresAt: input.quote.expiresAt,
        recipients: [...new Set(input.recipients)].sort(),
      },
    ),
  ];
}
