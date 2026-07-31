import type { WebhookVerifier } from "@clockwork/contracts";
import { WorkOS } from "@workos-inc/node";
import Stripe from "stripe";

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
    const event = await this.stripe.webhooks.constructEventAsync(
      input.rawBody,
      input.signature,
      this.secret,
      input.toleranceSeconds ?? 300,
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
    const event = await this.workos.webhooks.constructEvent({
      payload: input.rawBody,
      sigHeader: input.signature,
      secret: this.secret,
      tolerance: input.toleranceSeconds ?? 300,
    });
    return { eventId: event.id, occurredAt: event.createdAt, payload: event };
  }
}
