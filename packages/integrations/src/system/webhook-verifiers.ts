import type { WebhookVerifier } from "@clockwork/contracts";
import { WorkOS } from "@workos-inc/node";
import Stripe from "stripe";

/**
 * Freshness windows are declared in seconds by the caller contract. A
 * non-integer, negative, or non-finite window is never a legitimate
 * configuration and would disable the replay check in every SDK below
 * (`NaN`/`Infinity` comparisons are always false), so it is denied here.
 */
function toleranceSeconds(supplied: number | undefined, subject: string) {
  const seconds = supplied ?? 300;
  if (!Number.isSafeInteger(seconds) || seconds < 0)
    throw new Error(`${subject} tolerance must be a non-negative integer`);
  return seconds;
}

/**
 * A signed epoch, written the one way a provider writes it: decimal digits, no
 * sign, no leading zero, no whitespace, no exponent, no trailing text.
 */
const CANONICAL_EPOCH = /^[1-9][0-9]*$/;

/**
 * Reads `t=` out of a signature header and refuses to coerce anything it cannot
 * classify.
 *
 * Both SDKs below take the field as text and reach for a permissive numeric
 * parse, and the two parses disagree on exactly the inputs that matter.
 * `Number("")`, `Number(" ")`, `Number("\t")` and `Number("\n")` are all 0 —
 * finite, and far enough in the past that an upper bound waves them through —
 * while the past bound is `parseInt(timestamp, 10) < Date.now() - tolerance`
 * and `parseInt("", 10)` is `NaN`, so `NaN < x` is false and that bound never
 * fires either. One blank field skips both bounds, and the delivery it
 * authenticates then never expires. Bounding that window is this control's
 * whole job, so the shape is settled here, before any coercion, and an
 * unclassifiable field is denied rather than guessed at.
 *
 * The header's field list is checked with the same discipline. Both SDKs read
 * positionally: they split each field on "=" and keep index 1 without ever
 * checking that the timestamp field is named `t`, and they ignore fields past
 * the ones they expect. So a header naming no timestamp at all, and a header
 * naming two, both parse to a value that a second reader would not agree on.
 */
function signatureTimestampMilliseconds(input: {
  header: string;
  /** 1 for a millisecond epoch (WorkOS), 1_000 for a second epoch (Stripe). */
  millisecondsPerUnit: number;
  subject: string;
}) {
  const malformed = new Error(
    `${input.subject} signature timestamp is malformed`,
  );
  // Both SDKs read the timestamp POSITIONALLY — `header.split(",")[0]`, then
  // `.split("=")[1]` — without ever checking that field zero is named `t`. So
  // selecting it by key here would let the two readers disagree: given
  // `x=<far future>, v1=<signature over that>, t=<now>`, a key-based reader
  // validates the fresh `t` while the SDK authenticates and range-checks the
  // far-future `x`, whose future-dated value the SDK's past-only bound waves
  // through. The delivery is then authenticated on a timestamp nothing bounded.
  // Select the same bytes the SDK does, and require them to be named `t`.
  //
  // Only the separator's own padding is forgiven (`t=..., v1=...`). Whitespace
  // is never trimmed off the value itself: `t=123 ` and `t=123` would be two
  // spellings of one instant, and a value this cannot read literally is one it
  // cannot classify.
  const fields = input.header
    .split(",")
    .map((candidate) => candidate.trimStart());
  const [field] = fields;
  if (field === undefined || !field.startsWith("t=")) throw malformed;
  // A second `t=` anywhere still means two readers could disagree about which
  // instant this header names, so it stays unclassifiable even though field
  // zero is the one that counts.
  if (fields.slice(1).some((candidate) => candidate.startsWith("t=")))
    throw malformed;
  // Mirror the SDK's own `.split("=")[1]` exactly rather than slicing the
  // prefix: `t=1=2` yields "1" there and "1=2" here, and two readings of one
  // header is the condition this function exists to refuse.
  const parts = field.split("=");
  if (parts.length !== 2) throw malformed;
  const value = parts[1] ?? "";
  if (!CANONICAL_EPOCH.test(value)) throw malformed;
  const milliseconds = Number(value) * input.millisecondsPerUnit;
  if (!Number.isSafeInteger(milliseconds)) throw malformed;
  return milliseconds;
}

/**
 * Applies the freshness window in both directions.
 *
 * Neither SDK bounds the future: WorkOS checks only `timestamp < now -
 * tolerance`, and Stripe only `now - timestamp > tolerance`, so a future-dated
 * delivery ages toward the window instead of out of it and stays replayable
 * until it arrives. Stripe additionally refuses to honour a zero tolerance —
 * its ESM build rewrites it to the 300-second default (`tolerance ||
 * Webhook.DEFAULT_TOLERANCE`) and its CJS build skips the check outright
 * (`tolerance || 0`) — so the strictest window a caller can ask for is not the
 * window it gets. Enforcing the window here, on a timestamp whose shape is
 * already known, is what makes a leaked signature expire.
 */
function assertWithinTolerance(input: {
  milliseconds: number;
  toleranceMilliseconds: number;
  subject: string;
}) {
  if (Math.abs(input.milliseconds - Date.now()) > input.toleranceMilliseconds)
    throw new Error(`${input.subject} timestamp is outside tolerance`);
}

export class StripeWebhookVerifier implements WebhookVerifier<Stripe.Event> {
  private readonly stripe: Stripe;
  public constructor(
    private readonly secret: string,
    apiKey = process.env.STRIPE_SECRET_KEY ?? "sk_test_clockwork_unconfigured",
  ) {
    this.stripe = new Stripe(apiKey);
  }
  public async verify(
    input: Parameters<WebhookVerifier<Stripe.Event>["verify"]>[0],
  ) {
    // Stripe's tolerance argument is already in seconds, so it passes through.
    const seconds = toleranceSeconds(input.toleranceSeconds, "Stripe webhook");
    // Stripe's `t=` is a second epoch, and it signs `${parseInt(t, 10)}.${body}`
    // — so a blank field is authenticated as the string "NaN" and then compared
    // as `NaN > tolerance`, which is false. Shape first, then a two-sided window.
    assertWithinTolerance({
      milliseconds: signatureTimestampMilliseconds({
        header: input.signature,
        millisecondsPerUnit: 1_000,
        subject: "Stripe webhook",
      }),
      toleranceMilliseconds: seconds * 1_000,
      subject: "Stripe webhook",
    });
    const event = await this.stripe.webhooks.constructEventAsync(
      input.rawBody,
      input.signature,
      this.secret,
      seconds,
    );
    return {
      eventId: event.id,
      occurredAt: new Date(event.created * 1000).toISOString(),
      payload: event,
    };
  }
}

export class WorkosWebhookVerifier implements WebhookVerifier<
  Awaited<ReturnType<WorkOS["webhooks"]["constructEvent"]>>
> {
  private readonly workos: WorkOS;
  public constructor(
    private readonly secret: string,
    apiKey = process.env.WORKOS_API_KEY ?? "sk_test_clockwork_unconfigured",
  ) {
    this.workos = new WorkOS(apiKey);
  }
  public async verify(
    input: Parameters<
      WebhookVerifier<
        Awaited<ReturnType<WorkOS["webhooks"]["constructEvent"]>>
      >["verify"]
    >[0],
  ) {
    const seconds = toleranceSeconds(input.toleranceSeconds, "WorkOS webhook");
    // The WorkOS SDK compares `t=` against `Date.now()`, so both its header
    // timestamp and its tolerance are milliseconds. Passing seconds through
    // would reject every delivery older than a third of a second.
    const toleranceMilliseconds = seconds * 1_000;
    // The SDK bounds only the past (`timestamp < Date.now() - tolerance`), so a
    // future-dated delivery would stay replayable forever. Every sibling
    // verifier in this package is two-sided; close the upper bound to match.
    // The header is parsed here rather than through the SDK's own
    // getTimestampAndSignatureHash, which returns the raw field text without
    // deciding whether it is a timestamp at all.
    assertWithinTolerance({
      milliseconds: signatureTimestampMilliseconds({
        header: input.signature,
        millisecondsPerUnit: 1,
        subject: "WorkOS webhook",
      }),
      toleranceMilliseconds,
      subject: "WorkOS webhook",
    });
    const event = await this.workos.webhooks.constructEvent({
      payload: input.rawBody,
      sigHeader: input.signature,
      secret: this.secret,
      tolerance: toleranceMilliseconds,
    });
    return { eventId: event.id, occurredAt: event.createdAt, payload: event };
  }
}

/**
 * Routes a delivery to the verifier holding that provider's own signing secret,
 * so one provider's key can never sign another provider's events. The provider
 * identity is read from the unverified body, which is safe in one direction
 * only: picking the wrong verifier can make verification fail, never succeed.
 * A provider with no configured secret is denied — there is no shared fallback.
 */
export class ProviderScopedWebhookVerifier<T> implements WebhookVerifier<T> {
  public constructor(
    private readonly providerField: string,
    private readonly verifiers: ReadonlyMap<string, WebhookVerifier<T>>,
  ) {
    if (verifiers.size === 0)
      throw new Error(
        "Provider-scoped webhook verification requires at least one configured provider secret",
      );
  }

  public async verify(input: Parameters<WebhookVerifier<T>["verify"]>[0]) {
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(input.rawBody));
    } catch {
      throw new Error("Malformed webhook body");
    }
    if (typeof body !== "object" || body === null)
      throw new Error("Malformed webhook body");
    const claimed = (body as Record<string, unknown>)[this.providerField];
    const verifier =
      typeof claimed === "string" ? this.verifiers.get(claimed) : undefined;
    if (!verifier)
      throw new Error(
        "No webhook secret is configured for the claimed provider",
      );
    return verifier.verify(input);
  }
}
