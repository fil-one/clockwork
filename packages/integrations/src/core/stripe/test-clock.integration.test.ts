import { describe, expect, it } from "vitest";

type ClockEvent = {
  readonly type:
    | "invoice.paid"
    | "invoice.payment_failed"
    | "customer.subscription.updated"
    | "subscription_schedule.updated";
  readonly at: string;
  readonly priceId: string;
  readonly cycle: number;
};

type Interval = "month" | "year";

function addInterval(value: Date, interval: Interval): Date {
  const next = new Date(value);
  if (interval === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

/** Small deterministic analogue of Stripe test-clock advancement for CI. */
class DeterministicStripeBillingClock {
  private now: Date;
  private nextBilling: Date;
  private cycle = 0;
  private paymentSucceeds = true;
  private readonly emitted: ClockEvent[] = [];
  private readonly amendments: {
    at: Date;
    priceId: string;
    applied: boolean;
  }[] = [];

  public constructor(
    startsAt: string,
    private readonly interval: Interval,
    private priceId: string,
  ) {
    this.now = new Date(startsAt);
    this.nextBilling = new Date(startsAt);
  }

  public setPaymentSucceeds(value: boolean): void {
    this.paymentSucceeds = value;
  }

  public scheduleAmendment(at: string, priceId: string): void {
    this.amendments.push({ at: new Date(at), priceId, applied: false });
  }

  public advanceTo(target: string): readonly ClockEvent[] {
    const targetDate = new Date(target);
    if (targetDate < this.now)
      throw new RangeError("A test clock cannot move backward");
    const before = this.emitted.length;
    while (this.nextBilling <= targetDate) {
      for (const amendment of this.amendments) {
        if (!amendment.applied && amendment.at <= this.nextBilling) {
          amendment.applied = true;
          this.priceId = amendment.priceId;
          this.emitted.push({
            type: "subscription_schedule.updated",
            at: amendment.at.toISOString(),
            priceId: this.priceId,
            cycle: this.cycle,
          });
        }
      }
      this.cycle += 1;
      const at = this.nextBilling.toISOString();
      this.emitted.push({
        type: this.paymentSucceeds ? "invoice.paid" : "invoice.payment_failed",
        at,
        priceId: this.priceId,
        cycle: this.cycle,
      });
      if (this.cycle > 1)
        this.emitted.push({
          type: "customer.subscription.updated",
          at,
          priceId: this.priceId,
          cycle: this.cycle,
        });
      this.nextBilling = addInterval(this.nextBilling, this.interval);
    }
    this.now = targetDate;
    return this.emitted.slice(before);
  }
}

describe("deterministic Stripe test-clock scenarios", () => {
  it("covers an annual term and its renewal", () => {
    const clock = new DeterministicStripeBillingClock(
      "2026-01-01T00:00:00.000Z",
      "year",
      "price_annual",
    );
    expect(clock.advanceTo("2026-01-01T00:00:00.000Z")).toEqual([
      expect.objectContaining({ type: "invoice.paid", cycle: 1 }),
    ]);
    const renewal = clock.advanceTo("2027-01-01T00:00:00.000Z");
    expect(renewal).toEqual([
      expect.objectContaining({ type: "invoice.paid", cycle: 2 }),
      expect.objectContaining({
        type: "customer.subscription.updated",
        cycle: 2,
      }),
    ]);
  });

  it("covers monthly billing and a payment failure without moving the term clock", () => {
    const clock = new DeterministicStripeBillingClock(
      "2026-07-01T00:00:00.000Z",
      "month",
      "price_monthly",
    );
    clock.advanceTo("2026-07-01T00:00:00.000Z");
    clock.setPaymentSucceeds(false);
    const august = clock.advanceTo("2026-08-01T00:00:00.000Z");
    expect(august[0]).toMatchObject({
      type: "invoice.payment_failed",
      at: "2026-08-01T00:00:00.000Z",
      cycle: 2,
    });
    clock.setPaymentSucceeds(true);
    expect(clock.advanceTo("2026-09-01T00:00:00.000Z")[0]).toMatchObject({
      type: "invoice.paid",
      cycle: 3,
    });
  });

  it("applies an amendment schedule deterministically at the next billing boundary", () => {
    const clock = new DeterministicStripeBillingClock(
      "2026-07-01T00:00:00.000Z",
      "month",
      "price_before_amendment",
    );
    clock.advanceTo("2026-07-01T00:00:00.000Z");
    clock.scheduleAmendment(
      "2026-07-15T12:00:00.000Z",
      "price_after_amendment",
    );
    const events = clock.advanceTo("2026-08-01T00:00:00.000Z");
    expect(events).toEqual([
      expect.objectContaining({
        type: "subscription_schedule.updated",
        priceId: "price_after_amendment",
      }),
      expect.objectContaining({
        type: "invoice.paid",
        priceId: "price_after_amendment",
        cycle: 2,
      }),
      expect.objectContaining({
        type: "customer.subscription.updated",
        priceId: "price_after_amendment",
      }),
    ]);
  });
});
