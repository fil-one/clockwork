import type { MessageId } from "@/src/i18n";

/**
 * Why a client's response to a shared quote was not recorded.
 *
 * `recordClientReview` (partner lane, `demo-client-review.ts`) refuses with
 * English `Error` messages. The client must never see them: the respond route
 * answers with one of these codes and the review page words it in the reader's
 * language. A refusal this module does not recognize is reported as "unsent",
 * never passed through.
 */
export const clientReviewFailures = [
  "invalid",
  "describeChanges",
  "expired",
  "alreadyRecorded",
  "unsent",
] as const;
export type ClientReviewFailure = (typeof clientReviewFailures)[number];

export const clientReviewFailureMessages = {
  invalid: "demo.clientReview.error.invalid",
  describeChanges: "demo.clientReview.error.describeChanges",
  expired: "demo.clientReview.expired",
  alreadyRecorded: "demo.clientReview.error.alreadyRecorded",
  unsent: "demo.clientReview.error.unsent",
} as const satisfies Record<ClientReviewFailure, MessageId>;

/** The refusals `recordClientReview` throws, by their exact message. */
const refusals: ReadonlyMap<string, ClientReviewFailure> = new Map([
  // i18n-exempt: matches an error thrown by demo-client-review.ts; never shown
  ["Describe the changes you need.", "describeChanges"],
  [
    // i18n-exempt: matches an error thrown by demo-client-review.ts; never shown
    "This review link has expired or the quote was replaced. Ask your partner for the current quote.",
    "expired",
  ],
  // i18n-exempt: matches an error thrown by demo-client-review.ts; never shown
  ["Review link unavailable", "expired"],
  // i18n-exempt: matches an error thrown by demo-client-review.ts; never shown
  ["Quote unavailable", "expired"],
  [
    // i18n-exempt: matches an error thrown by demo-client-review.ts; never shown
    "A response is already recorded. Contact your partner to change it.",
    "alreadyRecorded",
  ],
]);

export function clientReviewFailure(error: unknown): ClientReviewFailure {
  if (!(error instanceof Error)) return "unsent";
  // A body that is not JSON, or does not match the response schema.
  if (error instanceof SyntaxError || error.name === "ZodError")
    return "invalid";
  return refusals.get(error.message) ?? "unsent";
}

export function isClientReviewFailure(
  value: unknown,
): value is ClientReviewFailure {
  return (
    typeof value === "string" &&
    (clientReviewFailures as readonly string[]).includes(value)
  );
}
