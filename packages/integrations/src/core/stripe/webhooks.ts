import { createHash } from "node:crypto";

import type { Money, WebhookVerifier } from "@clockwork/contracts";
import { MoneySchema } from "@clockwork/contracts";
import Stripe from "stripe";

import {
  isRecord,
  isoFromEpoch,
  optionalString,
  parseProviderMinorUnits,
  requiredString,
} from "../provider-result";

export type StripeFinancialCategory =
  | "customer"
  | "subscription"
  | "subscription_schedule"
  | "invoice"
  | "payment"
  | "credit_note"
  | "refund"
  | "dispute"
  | "tax"
  | "other";

export interface NormalizedStripeFinancialEvent {
  readonly provider: "stripe";
  readonly eventId: string;
  readonly eventType: string;
  readonly category: StripeFinancialCategory;
  readonly objectId: string;
  readonly aggregateKey: string;
  readonly occurredAt: string;
  readonly livemode: boolean;
  readonly requestId?: string;
  readonly requestIdempotencyKey?: string;
  readonly customerId?: string;
  readonly subscriptionId?: string;
  readonly scheduleId?: string;
  readonly invoiceId?: string;
  readonly paymentIntentId?: string;
  readonly creditNoteId?: string;
  readonly refundId?: string;
  readonly disputeId?: string;
  readonly amount?: Money;
  readonly status?: string;
  readonly rawObject: Record<string, unknown>;
}

export interface StripeWebhookClaim {
  readonly eventId: string;
  readonly eventType: string;
  readonly payloadHash: string;
  readonly occurredAt: string;
  readonly aggregateKey: string;
  readonly delivery: "live" | "operator_replay";
  readonly replayReason?: string;
  readonly replayedBy?: string;
}

export interface StripeWebhookCheckpoint {
  readonly eventId: string;
  readonly occurredAt: string;
}

export interface StripeWebhookInbox {
  claim(
    input: StripeWebhookClaim,
  ): Promise<"claimed" | "duplicate" | "in_progress" | "payload_conflict">;
  checkpoint(
    aggregateKey: string,
  ): Promise<StripeWebhookCheckpoint | undefined>;
  markProcessed(input: StripeWebhookClaim): Promise<void>;
  markFailed(eventId: string, error: string): Promise<void>;
}

export interface StripeWebhookDelivery {
  readonly event: NormalizedStripeFinancialEvent;
  readonly ordering: "current" | "out_of_order";
  readonly delivery: "live" | "operator_replay";
}

export interface StripeWebhookProcessingResult {
  readonly disposition: "processed" | "duplicate" | "in_progress";
  readonly eventId: string;
  readonly ordering?: "current" | "out_of_order";
}

export class StripeWebhookPayloadConflictError extends Error {
  public constructor(public readonly eventId: string) {
    super(
      `Stripe event ${eventId} was redelivered with different signed bytes`,
    );
    this.name = "StripeWebhookPayloadConflictError";
  }
}

/** Signature verification always consumes the untouched request bytes. */
export class StripeFinancialWebhookVerifier implements WebhookVerifier<Stripe.Event> {
  private readonly stripe: Stripe;

  public constructor(
    private readonly endpointSecret: string,
    configuration:
      | { readonly apiKey: string; readonly client?: never }
      | { readonly client: Stripe; readonly apiKey?: never },
  ) {
    if (!endpointSecret.startsWith("whsec_"))
      throw new Error("A Stripe webhook endpoint secret is required");
    this.stripe = configuration.client ?? new Stripe(configuration.apiKey);
  }

  public async verify(
    input: Parameters<WebhookVerifier<Stripe.Event>["verify"]>[0],
  ) {
    const event = await this.stripe.webhooks.constructEventAsync(
      input.rawBody,
      input.signature,
      this.endpointSecret,
      input.toleranceSeconds ?? 300,
    );
    return {
      eventId: event.id,
      occurredAt: isoFromEpoch(event.created),
      payload: event,
    };
  }
}

function categoryFor(type: string): StripeFinancialCategory {
  if (type.startsWith("customer.subscription.")) return "subscription";
  if (type.startsWith("subscription_schedule.")) return "subscription_schedule";
  if (type.startsWith("customer.")) return "customer";
  if (type.startsWith("invoice.")) return "invoice";
  if (type.startsWith("invoice_payment.")) return "payment";
  if (type.startsWith("payment_intent.") || type.startsWith("charge."))
    return type.startsWith("charge.dispute.") ? "dispute" : "payment";
  if (type.startsWith("credit_note.")) return "credit_note";
  if (type.startsWith("refund.")) return "refund";
  if (type.startsWith("tax.")) return "tax";
  return "other";
}

function referenceId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return isRecord(value) ? optionalString(value.id) : undefined;
}

function supportedMoney(object: Record<string, unknown>): Money | undefined {
  const amountCandidate =
    object.amount ??
    object.amount_paid ??
    object.amount_due ??
    object.total ??
    object.amount_total;
  const currency = optionalString(object.currency)?.toUpperCase();
  if (
    typeof amountCandidate !== "number" ||
    !Number.isSafeInteger(amountCandidate)
  )
    return undefined;
  const parsed = MoneySchema.safeParse({
    currency,
    minor: parseProviderMinorUnits(amountCandidate),
  });
  return parsed.success ? parsed.data : undefined;
}

function stripeRequest(event: Stripe.Event): {
  requestId?: string;
  requestIdempotencyKey?: string;
} {
  if (event.request === null) return {};
  if (typeof event.request === "string") return { requestId: event.request };
  return {
    ...(event.request.id === null ? {} : { requestId: event.request.id }),
    ...(event.request.idempotency_key === null
      ? {}
      : { requestIdempotencyKey: event.request.idempotency_key }),
  };
}

export function normalizeStripeFinancialEvent(
  event: Stripe.Event,
): NormalizedStripeFinancialEvent {
  const object = event.data.object as unknown;
  if (!isRecord(object))
    throw new TypeError("Stripe event data.object must be an object");
  const objectId = requiredString(object, "id");
  const category = categoryFor(event.type);
  const customerId = referenceId(object.customer);
  const subscriptionId =
    category === "subscription" ? objectId : referenceId(object.subscription);
  const scheduleId =
    category === "subscription_schedule"
      ? objectId
      : referenceId(object.schedule);
  const invoiceId =
    category === "invoice" ? objectId : referenceId(object.invoice);
  const paymentIntentId = event.type.startsWith("payment_intent.")
    ? objectId
    : referenceId(object.payment_intent);
  const creditNoteId = category === "credit_note" ? objectId : undefined;
  const refundId =
    category === "refund" ? objectId : referenceId(object.refund);
  const disputeId =
    category === "dispute" ? objectId : referenceId(object.dispute);
  const aggregateKey =
    invoiceId ??
    subscriptionId ??
    scheduleId ??
    paymentIntentId ??
    customerId ??
    objectId;
  const amount = supportedMoney(object);
  const eventStatus = optionalString(object.status);
  return {
    provider: "stripe",
    eventId: event.id,
    eventType: event.type,
    category,
    objectId,
    aggregateKey,
    occurredAt: isoFromEpoch(event.created),
    livemode: event.livemode,
    ...stripeRequest(event),
    ...(customerId === undefined ? {} : { customerId }),
    ...(subscriptionId === undefined ? {} : { subscriptionId }),
    ...(scheduleId === undefined ? {} : { scheduleId }),
    ...(invoiceId === undefined ? {} : { invoiceId }),
    ...(paymentIntentId === undefined ? {} : { paymentIntentId }),
    ...(creditNoteId === undefined ? {} : { creditNoteId }),
    ...(refundId === undefined ? {} : { refundId }),
    ...(disputeId === undefined ? {} : { disputeId }),
    ...(amount === undefined ? {} : { amount }),
    ...(eventStatus === undefined ? {} : { status: eventStatus }),
    rawObject: object,
  };
}

/**
 * Verification, durable claim, normalization, ordering classification, and
 * completion happen in that order. Late events are delivered and labeled;
 * consumers decide state transitions from the provider object, never arrival order.
 */
export class ReplaySafeStripeWebhookProcessor {
  public constructor(
    private readonly verifier: WebhookVerifier<Stripe.Event>,
    private readonly inbox: StripeWebhookInbox,
  ) {}

  public async process(input: {
    readonly rawBody: Uint8Array;
    readonly signature: string;
    readonly handler: (delivery: StripeWebhookDelivery) => Promise<void>;
    readonly replay?: { readonly reason: string; readonly actorId: string };
  }): Promise<StripeWebhookProcessingResult> {
    if (
      input.replay &&
      (!input.replay.reason.trim() || !input.replay.actorId.trim())
    )
      throw new TypeError("Operator replay requires a reason and actor ID");
    const verified = await this.verifier.verify({
      rawBody: input.rawBody,
      signature: input.signature,
    });
    const event = normalizeStripeFinancialEvent(verified.payload);
    const payloadHash = createHash("sha256")
      .update(input.rawBody)
      .digest("hex");
    const claim: StripeWebhookClaim = {
      eventId: verified.eventId,
      eventType: event.eventType,
      payloadHash,
      occurredAt: verified.occurredAt,
      aggregateKey: event.aggregateKey,
      delivery: input.replay ? "operator_replay" : "live",
      ...(input.replay === undefined
        ? {}
        : {
            replayReason: input.replay.reason,
            replayedBy: input.replay.actorId,
          }),
    };
    const claimed = await this.inbox.claim(claim);
    if (claimed === "payload_conflict")
      throw new StripeWebhookPayloadConflictError(event.eventId);
    if (claimed === "duplicate" || claimed === "in_progress")
      return { disposition: claimed, eventId: event.eventId };
    const checkpoint = await this.inbox.checkpoint(event.aggregateKey);
    const ordering =
      checkpoint &&
      (Date.parse(checkpoint.occurredAt) > Date.parse(event.occurredAt) ||
        (checkpoint.occurredAt === event.occurredAt &&
          checkpoint.eventId > event.eventId))
        ? "out_of_order"
        : "current";
    try {
      await input.handler({ event, ordering, delivery: claim.delivery });
      await this.inbox.markProcessed(claim);
      return { disposition: "processed", eventId: event.eventId, ordering };
    } catch (error) {
      await this.inbox.markFailed(
        event.eventId,
        error instanceof Error ? error.message : "Webhook handler failed",
      );
      throw error;
    }
  }
}

/** Deterministic test/local inbox with the same claim and watermark semantics. */
export class InMemoryStripeWebhookInbox implements StripeWebhookInbox {
  private readonly deliveries = new Map<
    string,
    { payloadHash: string; state: "processing" | "processed" | "failed" }
  >();
  private readonly checkpoints = new Map<string, StripeWebhookCheckpoint>();

  public claim(input: StripeWebhookClaim) {
    const existing = this.deliveries.get(input.eventId);
    if (existing && existing.payloadHash !== input.payloadHash)
      return Promise.resolve("payload_conflict" as const);
    if (existing?.state === "processing")
      return Promise.resolve("in_progress" as const);
    if (input.delivery === "operator_replay") {
      if (!existing) return Promise.resolve("payload_conflict" as const);
      this.deliveries.set(input.eventId, {
        payloadHash: input.payloadHash,
        state: "processing",
      });
      return Promise.resolve("claimed" as const);
    }
    if (existing?.state === "processed")
      return Promise.resolve("duplicate" as const);
    this.deliveries.set(input.eventId, {
      payloadHash: input.payloadHash,
      state: "processing",
    });
    return Promise.resolve("claimed" as const);
  }

  public checkpoint(aggregateKey: string) {
    return Promise.resolve(this.checkpoints.get(aggregateKey));
  }

  public markProcessed(input: StripeWebhookClaim): Promise<void> {
    this.deliveries.set(input.eventId, {
      payloadHash: input.payloadHash,
      state: "processed",
    });
    const checkpoint = this.checkpoints.get(input.aggregateKey);
    if (
      !checkpoint ||
      Date.parse(checkpoint.occurredAt) < Date.parse(input.occurredAt) ||
      (checkpoint.occurredAt === input.occurredAt &&
        checkpoint.eventId < input.eventId)
    ) {
      this.checkpoints.set(input.aggregateKey, {
        eventId: input.eventId,
        occurredAt: input.occurredAt,
      });
    }
    return Promise.resolve();
  }

  public markFailed(eventId: string, _error: string): Promise<void> {
    const existing = this.deliveries.get(eventId);
    if (existing)
      this.deliveries.set(eventId, {
        payloadHash: existing.payloadHash,
        state: "failed",
      });
    return Promise.resolve();
  }
}
