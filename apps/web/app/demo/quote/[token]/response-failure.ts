import type { ClientReviewRefusal } from "@/src/features/customer-partner/partner/demo-client-review";
import type { MessageId } from "@/src/i18n";

/**
 * Why a client's response to a shared quote was not recorded.
 *
 * `recordClientReview` (partner lane, `demo-client-review.ts`) refuses with a
 * `ClientReviewRefusal` carrying a stable code and an English API sentence.
 * The client must never see the sentence: the respond route answers with one
 * of these failures and the review page words it in the reader's language. A
 * refusal this module does not recognize is reported as "unsent", never passed
 * through.
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

/**
 * The recorder's refusal codes (`ClientReviewRefusal.code`), by meaning.
 *
 * This used to match the refusals' exact English sentences, so rewording one
 * in the recorder silently turned it into "could not be sent". The code is the
 * contract; the sentence is only API text. The type import is erased at build
 * time, so this module stays safe for the review page's client bundle.
 */
const refusals: Readonly<
  Record<ClientReviewRefusal["code"], ClientReviewFailure>
> = {
  CHANGES_NOTE_REQUIRED: "describeChanges",
  REVIEW_LINK_EXPIRED: "expired",
  QUOTE_UNAVAILABLE: "expired",
  RESPONSE_ALREADY_RECORDED: "alreadyRecorded",
};

export function clientReviewFailure(error: unknown): ClientReviewFailure {
  if (!(error instanceof Error)) return "unsent";
  // A body that is not JSON, or does not match the response schema.
  if (error instanceof SyntaxError || error.name === "ZodError")
    return "invalid";
  const code: unknown = "code" in error ? error.code : undefined;
  return typeof code === "string" && Object.hasOwn(refusals, code)
    ? refusals[code as ClientReviewRefusal["code"]]
    : "unsent";
}

export function isClientReviewFailure(
  value: unknown,
): value is ClientReviewFailure {
  return (
    typeof value === "string" &&
    (clientReviewFailures as readonly string[]).includes(value)
  );
}
