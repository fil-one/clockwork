import Stripe from "stripe";

export interface StripeInvoicePaymentSession {
  provider: "stripe";
  sessionId: string;
  invoiceId: string;
  url: string;
  status: "requires_customer_action";
}

export interface StripeInvoiceRecord {
  id: string;
  customer: string | { id: string } | null;
  hosted_invoice_url?: string | null;
  status: string | null;
}

export interface StripeInvoiceReader {
  invoices: {
    retrieve(id: string): Promise<StripeInvoiceRecord>;
  };
}

/**
 * Returns Stripe's invoice-hosted payment session. It never reports payment as
 * complete; only the later signed webhook may advance local payment truth.
 */
export class StripeInvoicePaymentSessionGateway {
  private readonly stripe: StripeInvoiceReader;

  public constructor(
    configuration: { apiKey: string } | { client: StripeInvoiceReader },
  ) {
    if ("client" in configuration) {
      this.stripe = configuration.client;
      return;
    }
    if (!configuration.apiKey.startsWith("sk_"))
      throw new Error("A Stripe secret API key is required");
    this.stripe = new Stripe(configuration.apiKey, {
      appInfo: { name: "Clockwork Commerce", version: "1" },
      maxNetworkRetries: 2,
      timeout: 30_000,
    });
  }

  public async create(input: {
    stripeInvoiceId: string;
    stripeCustomerId: string;
  }): Promise<StripeInvoicePaymentSession> {
    const invoice = await this.stripe.invoices.retrieve(input.stripeInvoiceId);
    const customerId =
      typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer?.id ?? null);
    if (customerId !== input.stripeCustomerId)
      throw new Error("Stripe invoice customer binding mismatch");
    if (invoice.status !== "open")
      throw new Error("Stripe invoice is not open for customer payment");
    if (!invoice.hosted_invoice_url)
      throw new Error("Stripe did not provide a hosted invoice payment URL");
    const url = new URL(invoice.hosted_invoice_url);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "stripe.com" && !url.hostname.endsWith(".stripe.com"))
    )
      throw new Error("Stripe returned an untrusted hosted invoice URL");
    return {
      provider: "stripe",
      sessionId: invoice.id,
      invoiceId: invoice.id,
      url: url.toString(),
      status: "requires_customer_action",
    };
  }
}
