import type { MessageId } from "@/src/i18n";

/**
 * The message a partner sees when a command fails.
 *
 * A problem document's `detail` is English written for the API, so it is never
 * shown. The problem code says what happened; the reader gets that in their
 * own language, and anything unrecognized gets the caller's fallback, which
 * always states whether anything changed.
 */
const problemMessages: Readonly<Record<string, MessageId>> = {
  VERSION_CONFLICT: "partner.error.versionConflict",
  IDEMPOTENCY_CONFLICT: "partner.error.versionConflict",
  QUOTE_EXPIRED: "partner.error.quoteExpired",
  QUOTE_ACCEPTED: "partner.error.quoteAccepted",
  QUOTE_IMMUTABLE: "partner.error.quoteImmutable",
  INVALID_STATE: "partner.error.invalidState",
  PRICING_REVIEW_REQUIRED: "partner.error.pricingReview",
  PRICING_REFUSED: "partner.error.pricingRefused",
  PRICE_BOOK_NOT_FOUND: "partner.error.priceBookUnavailable",
  REVISION_CONTEXT_CHANGED: "partner.error.revisionContext",
  DOCUMENT_NOT_READY: "partner.error.documentsNotReady",
  REGISTRATION_PROTECTION_POLICY_EXCEEDED: "partner.error.protectionPolicy",
  REGISTRATION_EXISTS: "partner.error.registrationExists",
};

/**
 * `CommerceApiError` by its name rather than `instanceof`, so this module does
 * not pull the client transport in and a mocked transport still classifies.
 */
function commerceFailure(
  error: unknown,
): { code?: unknown; problemCode?: unknown } | undefined {
  return error instanceof Error && error.name === "CommerceApiError"
    ? (error as Error & { code?: unknown; problemCode?: unknown })
    : undefined;
}

export function partnerCommandFailure(
  error: unknown,
  fallback: MessageId,
): MessageId {
  const failure = commerceFailure(error);
  if (!failure) return fallback;
  const code =
    typeof failure.problemCode === "string" ? failure.problemCode : undefined;
  if (code && Object.hasOwn(problemMessages, code))
    return problemMessages[code] ?? fallback;
  if (code?.endsWith("_FORBIDDEN")) return "partner.error.forbidden";
  // No server code: the client refused before sending (a missing form token).
  if (failure.code === "forbidden" && !code) return "partner.error.session";
  if (failure.code === "unavailable") return "partner.error.unavailable";
  return fallback;
}
