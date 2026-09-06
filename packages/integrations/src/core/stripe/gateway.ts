import type {
  BillingPort,
  IdempotencyKey,
  ProviderResult,
} from "@clockwork/contracts";
import { IdempotencyKeySchema, MoneySchema } from "@clockwork/contracts";
import Stripe from "stripe";

import {
  derivedIdempotencyKey,
  epochSeconds,
  isoFromEpoch,
  parseProviderMinorUnits,
  stableExternalId,
  toProviderFailure,
  toSafeMinorUnits,
} from "../provider-result";
import type {
  StripeCollectionPolicy,
  StripeCommercialGateway,
  StripeCustomerInput,
  StripeInvoiceInput,
  StripeLedgerBillingPort,
  StripeSubscriptionInput,
  StripeTaxCalculationInput,
} from "./types";

export interface StripeGatewayConfiguration {
  readonly apiKey?: string;
  readonly client?: Stripe;
  readonly apiVersion?: Stripe.LatestApiVersion;
}

function requestOptions(key: string, operation: string): Stripe.RequestOptions {
  return { idempotencyKey: derivedIdempotencyKey(key, operation) };
}

function collectionParams(collection: StripeCollectionPolicy): {
  collection_method: "charge_automatically" | "send_invoice";
  days_until_due?: number;
  default_payment_method?: string;
} {
  if (collection.kind === "net_terms") {
    if (
      !Number.isInteger(collection.days) ||
      collection.days < 1 ||
      collection.days > 365
    )
      throw new RangeError(
        "Net terms must be a whole number from 1 through 365 days",
      );
    return {
      collection_method: "send_invoice",
      days_until_due: collection.days,
    };
  }
  return {
    collection_method: "charge_automatically",
    ...(collection.paymentMethodId === undefined
      ? {}
      : { default_payment_method: collection.paymentMethodId }),
  };
}

function customerAddress(
  address: NonNullable<StripeCustomerInput["address"]>,
): Stripe.AddressParam {
  return {
    line1: address.line1,
    ...(address.line2 === undefined ? {} : { line2: address.line2 }),
    city: address.city,
    ...(address.state === undefined ? {} : { state: address.state }),
    postal_code: address.postalCode,
    country: address.country,
  };
}

function status(value: string | null): string {
  return value ?? "unknown";
}

function lastFour(paymentMethod: Stripe.PaymentMethod): string | undefined {
  return (
    paymentMethod.card?.last4 ??
    paymentMethod.us_bank_account?.last4 ??
    paymentMethod.bacs_debit?.last4 ??
    paymentMethod.sepa_debit?.last4 ??
    undefined
  );
}

/**
 * Stripe is the invoice/payment subledger. Order, proration, commitment, and
 * partner-credit decisions must be completed before calling this adapter.
 */
export class StripeFinanceGateway
  implements BillingPort, StripeCommercialGateway, StripeLedgerBillingPort
{
  private readonly stripe: Stripe;

  public constructor(configuration: StripeGatewayConfiguration) {
    if (configuration.client) {
      this.stripe = configuration.client;
      return;
    }
    if (!configuration.apiKey?.startsWith("sk_"))
      throw new Error(
        "A Stripe secret API key or injected Stripe client is required",
      );
    this.stripe = new Stripe(configuration.apiKey, {
      ...(configuration.apiVersion === undefined
        ? {}
        : { apiVersion: configuration.apiVersion }),
      appInfo: { name: "Clockwork Commerce", version: "1" },
      maxNetworkRetries: 2,
      timeout: 30_000,
    });
  }

  public async createCustomer(
    input: Parameters<BillingPort["createCustomer"]>[0],
  ): ReturnType<BillingPort["createCustomer"]> {
    try {
      const customer = await this.stripe.customers.create(
        {
          email: input.email,
          metadata: { account_id: input.accountId },
        },
        requestOptions(input.idempotencyKey, "customer"),
      );
      return { ok: true, value: { customerId: customer.id } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async createCommercialCustomer(
    input: StripeCustomerInput,
  ): ReturnType<StripeCommercialGateway["createCommercialCustomer"]> {
    try {
      const address = input.address
        ? customerAddress(input.address)
        : undefined;
      const customer = await this.stripe.customers.create(
        {
          name: input.legalName,
          email: input.billingEmail,
          ...(address === undefined ? {} : { address }),
          tax_exempt: input.taxExempt ?? "none",
          metadata: { account_id: input.accountId },
        },
        requestOptions(input.idempotencyKey, "customer"),
      );
      const taxIdIds: string[] = [];
      for (const [index, taxId] of (input.taxIds ?? []).entries()) {
        const created = await this.stripe.customers.createTaxId(
          customer.id,
          { type: taxId.type, value: taxId.value },
          requestOptions(
            input.idempotencyKey,
            `customer-tax-id:${String(index)}`,
          ),
        );
        taxIdIds.push(created.id);
      }
      return { ok: true, value: { customerId: customer.id, taxIdIds } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async updateCommercialCustomer(
    customerId: string,
    input: Omit<StripeCustomerInput, "idempotencyKey"> & {
      readonly idempotencyKey: IdempotencyKey;
    },
  ): ReturnType<StripeCommercialGateway["updateCommercialCustomer"]> {
    try {
      const address = input.address
        ? customerAddress(input.address)
        : undefined;
      const customer = await this.stripe.customers.update(
        customerId,
        {
          name: input.legalName,
          email: input.billingEmail,
          ...(address === undefined ? {} : { address }),
          tax_exempt: input.taxExempt ?? "none",
          metadata: { account_id: input.accountId },
        },
        requestOptions(input.idempotencyKey, "customer-update"),
      );
      for (const [index, taxId] of (input.taxIds ?? []).entries()) {
        await this.stripe.customers.createTaxId(
          customerId,
          { type: taxId.type, value: taxId.value },
          requestOptions(
            input.idempotencyKey,
            `customer-tax-id:${String(index)}`,
          ),
        );
      }
      return { ok: true, value: { customerId: customer.id } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async createSubscription(
    input: StripeSubscriptionInput,
  ): ReturnType<StripeCommercialGateway["createSubscription"]> {
    try {
      if (input.items.length === 0)
        throw new TypeError("A subscription needs an item");
      const collection = collectionParams(input.collection);
      const subscription = await this.stripe.subscriptions.create(
        {
          customer: input.customerId,
          items: input.items.map((item) => ({
            price: item.priceId,
            ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
          })),
          collection_method: collection.collection_method,
          ...(collection.days_until_due === undefined
            ? {}
            : { days_until_due: collection.days_until_due }),
          ...(collection.default_payment_method === undefined
            ? {}
            : { default_payment_method: collection.default_payment_method }),
          ...(input.billingAnchorAt === undefined
            ? {}
            : { billing_cycle_anchor: epochSeconds(input.billingAnchorAt) }),
          automatic_tax: { enabled: true },
          metadata: { order_id: input.orderId },
        },
        requestOptions(input.idempotencyKey, "subscription"),
      );
      return {
        ok: true,
        value: { subscriptionId: subscription.id, status: subscription.status },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async createSubscriptionSchedule(
    input: Parameters<StripeCommercialGateway["createSubscriptionSchedule"]>[0],
  ): ReturnType<StripeCommercialGateway["createSubscriptionSchedule"]> {
    try {
      if (input.phases.length === 0)
        throw new TypeError("A schedule needs a phase");
      for (let index = 1; index < input.phases.length; index += 1) {
        const prior = input.phases[index - 1];
        const current = input.phases[index];
        if (
          !prior ||
          !current ||
          epochSeconds(prior.endsAt) !== epochSeconds(current.startsAt)
        )
          throw new RangeError(
            "Subscription schedule phases must be contiguous",
          );
      }
      const schedule = await this.stripe.subscriptionSchedules.create(
        {
          customer: input.customerId,
          start_date: epochSeconds(input.phases[0]?.startsAt ?? ""),
          end_behavior: input.endBehavior,
          phases: input.phases.map((phase) => {
            const collection = collectionParams(phase.collection);
            return {
              start_date: epochSeconds(phase.startsAt),
              end_date: epochSeconds(phase.endsAt),
              items: phase.items.map((item) => ({
                price: item.priceId,
                ...(item.quantity === undefined
                  ? {}
                  : { quantity: item.quantity }),
              })),
              collection_method: collection.collection_method,
              ...(collection.days_until_due === undefined
                ? {}
                : {
                    invoice_settings: {
                      days_until_due: collection.days_until_due,
                    },
                  }),
              ...(collection.default_payment_method === undefined
                ? {}
                : {
                    default_payment_method: collection.default_payment_method,
                  }),
              automatic_tax: { enabled: true },
            };
          }),
          metadata: { order_id: input.orderId },
        },
        requestOptions(input.idempotencyKey, "subscription-schedule"),
      );
      return {
        ok: true,
        value: { scheduleId: schedule.id, status: schedule.status },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async issueInvoice(
    input: Parameters<BillingPort["issueInvoice"]>[0],
  ): ReturnType<BillingPort["issueInvoice"]> {
    return this.createInvoice({
      customerId: input.customerId,
      ...(input.paygSource
        ? { paygSource: input.paygSource }
        : { orderId: input.orderId }),
      invoiceReference: input.invoiceId,
      currency: input.amount.currency,
      lines: [
        {
          lineId: input.invoiceId,
          description: input.paygSource
            ? `PAYG ${input.paygSource.month} revision ${input.paygSource.revision}`
            : `Order ${input.orderId}`,
          amount: input.amount,
          taxCode: "",
        },
      ],
      collection: { kind: "auto_charge" },
      ...(input.poNumber === undefined ? {} : { poNumber: input.poNumber }),
      autoFinalize: true,
      idempotencyKey: input.idempotencyKey,
    });
  }

  public async createInvoice(
    input: StripeInvoiceInput,
  ): ReturnType<StripeCommercialGateway["createInvoice"]> {
    try {
      if (input.lines.length === 0)
        throw new TypeError("An invoice needs a line");
      if ((input.orderId === undefined) === (input.paygSource === undefined))
        throw new TypeError(
          "Invoice requires exactly one order or PAYG source",
        );
      const collection = collectionParams(input.collection);
      for (const line of input.lines) {
        if (line.amount.currency !== input.currency)
          throw new TypeError(
            "Every invoice line must use the invoice currency",
          );
      }
      const invoice = await this.stripe.invoices.create(
        {
          customer: input.customerId,
          currency: input.currency.toLowerCase(),
          collection_method: collection.collection_method,
          ...(collection.days_until_due === undefined
            ? {}
            : { days_until_due: collection.days_until_due }),
          ...(collection.default_payment_method === undefined
            ? {}
            : { default_payment_method: collection.default_payment_method }),
          automatic_tax: {
            enabled: input.lines.every((line) => line.taxCode.length > 0),
          },
          auto_advance: false,
          ...(input.poNumber === undefined
            ? {}
            : { custom_fields: [{ name: "PO", value: input.poNumber }] }),
          metadata: {
            ...(input.paygSource
              ? {
                  billing_source: "payg",
                  payg_enrollment_id: input.paygSource.enrollmentId,
                  payg_effect_key: input.paygSource.effectKey,
                  payg_month: input.paygSource.month,
                  payg_revision: String(input.paygSource.revision),
                }
              : { order_id: input.orderId }),
            commerce_invoice_id: input.invoiceReference,
            ...(input.poNumber === undefined
              ? {}
              : { po_number: input.poNumber }),
          },
        },
        requestOptions(input.idempotencyKey, "invoice"),
      );
      for (const [index, line] of input.lines.entries()) {
        await this.stripe.invoiceItems.create(
          {
            invoice: invoice.id,
            customer: input.customerId,
            amount: toSafeMinorUnits(line.amount),
            currency: input.currency.toLowerCase(),
            description: line.description,
            ...(line.taxCode.length === 0 ? {} : { tax_code: line.taxCode }),
            ...(line.servicePeriod === undefined
              ? {}
              : {
                  period: {
                    start: epochSeconds(line.servicePeriod.startsAt),
                    end: epochSeconds(line.servicePeriod.endsAt),
                  },
                }),
            metadata: {
              commerce_line_id: line.lineId,
              ...(line.endClientAccountId === undefined
                ? {}
                : { end_client_account_id: line.endClientAccountId }),
            },
          },
          requestOptions(input.idempotencyKey, `invoice-line:${String(index)}`),
        );
      }
      if (input.autoFinalize === false)
        return {
          ok: true,
          value: {
            providerInvoiceId: invoice.id,
            status: status(invoice.status),
          },
        };
      const finalized = await this.stripe.invoices.finalizeInvoice(
        invoice.id,
        {},
        requestOptions(input.idempotencyKey, "invoice-finalize"),
      );
      if (collection.collection_method === "send_invoice") {
        await this.stripe.invoices.sendInvoice(
          finalized.id,
          {},
          requestOptions(input.idempotencyKey, "invoice-send"),
        );
      }
      return {
        ok: true,
        value: {
          providerInvoiceId: finalized.id,
          status: status(finalized.status),
        },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async calculateTax(
    input: StripeTaxCalculationInput,
  ): ReturnType<StripeCommercialGateway["calculateTax"]> {
    try {
      if (input.lines.length === 0)
        throw new TypeError("A tax calculation needs a line");
      const calculation = await this.stripe.tax.calculations.create(
        {
          customer: input.customerId,
          currency: input.currency.toLowerCase(),
          line_items: input.lines.map((line) => {
            if (line.amount.currency !== input.currency)
              throw new TypeError(
                "Every tax line must use the calculation currency",
              );
            return {
              reference: line.reference,
              amount: toSafeMinorUnits(line.amount),
              tax_code: line.taxCode,
              ...(line.quantity === undefined
                ? {}
                : { quantity: line.quantity }),
            };
          }),
        },
        requestOptions(input.idempotencyKey, "tax-calculation"),
      );
      if (calculation.id === null)
        throw new TypeError(
          "Stripe tax calculation did not return a persistent ID",
        );
      return {
        ok: true,
        value: {
          calculationId: calculation.id,
          tax: MoneySchema.parse({
            currency: input.currency,
            minor: parseProviderMinorUnits(calculation.tax_amount_exclusive),
          }),
          total: MoneySchema.parse({
            currency: input.currency,
            minor: parseProviderMinorUnits(calculation.amount_total),
          }),
        },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async attachPaymentMethod(
    input: Parameters<StripeCommercialGateway["attachPaymentMethod"]>[0],
  ): ReturnType<StripeCommercialGateway["attachPaymentMethod"]> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.attach(
        input.paymentMethodId,
        { customer: input.customerId },
        requestOptions(input.idempotencyKey, "payment-method-attach"),
      );
      if (input.makeDefault) {
        await this.stripe.customers.update(
          input.customerId,
          { invoice_settings: { default_payment_method: paymentMethod.id } },
          requestOptions(input.idempotencyKey, "payment-method-default"),
        );
      }
      return { ok: true, value: { paymentMethodId: paymentMethod.id } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async detachPaymentMethod(
    input: Parameters<StripeCommercialGateway["detachPaymentMethod"]>[0],
  ): ReturnType<StripeCommercialGateway["detachPaymentMethod"]> {
    try {
      const paymentMethod = await this.stripe.paymentMethods.detach(
        input.paymentMethodId,
        {},
        requestOptions(input.idempotencyKey, "payment-method-detach"),
      );
      return { ok: true, value: { paymentMethodId: paymentMethod.id } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async listPaymentMethods(
    customerId: string,
  ): ReturnType<StripeCommercialGateway["listPaymentMethods"]> {
    try {
      const result = await this.stripe.paymentMethods.list({
        customer: customerId,
        limit: 100,
      });
      return {
        ok: true,
        value: result.data.map((paymentMethod) => {
          const last4 = lastFour(paymentMethod);
          return {
            id: paymentMethod.id,
            type: paymentMethod.type,
            ...(last4 === undefined ? {} : { last4 }),
            reusable: paymentMethod.allow_redisplay !== "never",
          };
        }),
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async createBankTransferInstructions(
    input: Parameters<
      StripeCommercialGateway["createBankTransferInstructions"]
    >[0],
  ): ReturnType<StripeCommercialGateway["createBankTransferInstructions"]> {
    try {
      const instructions =
        await this.stripe.customers.createFundingInstructions(
          input.customerId,
          {
            funding_type: "bank_transfer",
            currency: input.currency.toLowerCase(),
            bank_transfer: { type: input.rail },
          },
          requestOptions(input.idempotencyKey, "bank-transfer-instructions"),
        );
      return {
        ok: true,
        value: {
          currency: input.currency,
          financialAddresses:
            instructions.bank_transfer.financial_addresses.map((address) => ({
              ...address,
            })),
        },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async getReceipt(
    input: Parameters<StripeCommercialGateway["getReceipt"]>[0],
  ): ReturnType<StripeCommercialGateway["getReceipt"]> {
    try {
      const [invoice, payments] = await Promise.all([
        this.stripe.invoices.retrieve(input.invoiceId),
        this.stripe.invoicePayments.list({
          invoice: input.invoiceId,
          status: "paid",
          limit: 1,
          expand: ["data.payment.payment_intent.latest_charge"],
        }),
      ]);
      const payment = payments.data[0]?.payment.payment_intent;
      const paymentIntent = typeof payment === "object" ? payment : undefined;
      const latestCharge = paymentIntent?.latest_charge;
      const receiptUrl =
        latestCharge !== null && typeof latestCharge === "object"
          ? (latestCharge.receipt_url ?? undefined)
          : undefined;
      return {
        ok: true,
        value: {
          ...(invoice.hosted_invoice_url === null
            ? {}
            : { hostedInvoiceUrl: invoice.hosted_invoice_url }),
          ...(invoice.invoice_pdf === null
            ? {}
            : { invoicePdf: invoice.invoice_pdf }),
          ...(receiptUrl === undefined ? {} : { receiptUrl }),
        },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async reportMeteredOverage(
    input: Parameters<StripeCommercialGateway["reportMeteredOverage"]>[0],
  ): ReturnType<StripeCommercialGateway["reportMeteredOverage"]> {
    try {
      const event = await this.stripe.billing.meterEvents.create(
        {
          event_name: input.eventName,
          identifier: input.usageEventId,
          timestamp: epochSeconds(input.occurredAt),
          payload: {
            stripe_customer_id: input.customerId,
            value: input.quantity,
          },
        },
        requestOptions(input.idempotencyKey, "meter-overage"),
      );
      return { ok: true, value: { meterEventIdentifier: event.identifier } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async addMeteredOverageLine(
    input: Parameters<StripeCommercialGateway["addMeteredOverageLine"]>[0],
  ): ReturnType<StripeCommercialGateway["addMeteredOverageLine"]> {
    try {
      if (input.ledgerEntryIds.length === 0)
        throw new TypeError("A metered overage line needs a ledger entry");
      const sourceUsage = input.sourceUsageIds.join(",");
      const invoiceItem = await this.stripe.invoiceItems.create(
        {
          invoice: input.invoiceId,
          customer: input.customerId,
          amount: toSafeMinorUnits(input.amount),
          currency: input.amount.currency.toLowerCase(),
          description: input.description,
          tax_code: input.taxCode,
          period: {
            start: epochSeconds(input.servicePeriod.startsAt),
            end: epochSeconds(input.servicePeriod.endsAt),
          },
          metadata: {
            order_id: input.orderId,
            sku: input.sku,
            ledger_entry_ids: input.ledgerEntryIds.join(",").slice(0, 500),
            source_usage_sha256: stableExternalId(
              "usage",
              input.sourceUsageIds,
            ),
            ...(sourceUsage.length > 500
              ? {}
              : { source_usage_ids: sourceUsage }),
          },
        },
        requestOptions(
          input.idempotencyKey,
          `overage:${input.ledgerEntryIds.join(":")}`,
        ),
      );
      return { ok: true, value: { invoiceItemId: invoiceItem.id } };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async syncOverage(
    input: Parameters<StripeLedgerBillingPort["syncOverage"]>[0],
  ): ReturnType<StripeLedgerBillingPort["syncOverage"]> {
    if (input.lines.length === 0)
      return {
        ok: true,
        value: { providerInvoiceItemIds: [], duplicateSourceUsageIds: [] },
      };
    const providerInvoiceItemIds: string[] = [];
    for (const line of input.lines) {
      if (line.amount.currency !== line.contractedUnitRate.currency)
        return {
          ok: false,
          kind: "permanent",
          code: "OVERAGE_CURRENCY_MISMATCH",
          message:
            "Overage amount and contracted unit rate must use one currency",
        };
      const lineKey = IdempotencyKeySchema.parse(
        derivedIdempotencyKey(input.idempotencyKey, line.ledgerEntryId),
      );
      const result = await this.addMeteredOverageLine({
        invoiceId: input.providerInvoiceId,
        customerId: input.customerId,
        orderId: input.orderId,
        ledgerEntryIds: [line.ledgerEntryId],
        sourceUsageIds: line.sourceUsageIds,
        sku: line.sku,
        description: `${line.sku} contracted overage (${line.quantity})`,
        amount: line.amount,
        taxCode: line.taxCode,
        servicePeriod: {
          startsAt: input.periodStart,
          endsAt: input.periodEnd,
        },
        idempotencyKey: lineKey,
      });
      if (!result.ok) return result;
      providerInvoiceItemIds.push(result.value.invoiceItemId);
    }
    return {
      ok: true,
      value: { providerInvoiceItemIds, duplicateSourceUsageIds: [] },
    };
  }

  public async issueCreditNote(
    input: Parameters<StripeCommercialGateway["issueCreditNote"]>[0],
  ): ReturnType<StripeCommercialGateway["issueCreditNote"]> {
    try {
      const amount = toSafeMinorUnits(input.amount);
      const operationKey = stableExternalId("credit", input.idempotencyKey);
      // Recover a crash after Stripe accepted a credit, before previewing again:
      // the original credit may have consumed the whole creditable amount.
      let matched: Stripe.CreditNote | undefined;
      for await (const prior of this.stripe.creditNotes.list({
        invoice: input.invoiceId,
        limit: 100,
      })) {
        if (prior.metadata?.clockwork_operation !== operationKey) continue;
        if (
          (typeof prior.invoice === "string"
            ? prior.invoice
            : prior.invoice.id) !== input.invoiceId ||
          prior.amount !== amount ||
          prior.currency !== input.amount.currency.toLowerCase() ||
          prior.reason !== input.reason ||
          prior.metadata.reason_code !== input.internalReasonCode
        )
          throw new TypeError(
            "Persisted Stripe credit operation conflicts with its retained request",
          );
        if (matched)
          throw new TypeError(
            "Stripe credit operation has ambiguous duplicate provider notes",
          );
        matched = prior;
      }
      if (matched)
        return {
          ok: true,
          value: { creditNoteId: matched.id, status: matched.status },
        };
      const preview = await this.stripe.creditNotes.preview({
        invoice: input.invoiceId,
        amount,
        reason: input.reason,
      });
      const postPayment = preview.post_payment_amount;
      if (
        (typeof preview.invoice === "string"
          ? preview.invoice
          : preview.invoice.id) !== input.invoiceId ||
        preview.amount !== amount ||
        preview.currency !== input.amount.currency.toLowerCase() ||
        !Number.isSafeInteger(postPayment) ||
        postPayment < 0 ||
        postPayment > amount ||
        preview.pre_payment_amount + postPayment !== amount
      )
        throw new TypeError(
          "Stripe credit preview does not match the retained credit amount",
        );
      const creditNote = await this.stripe.creditNotes.create(
        {
          invoice: input.invoiceId,
          amount,
          credit_amount: postPayment,
          reason: input.reason,
          metadata: {
            reason_code: input.internalReasonCode,
            clockwork_operation: operationKey,
          },
        },
        requestOptions(input.idempotencyKey, "credit-note"),
      );
      return {
        ok: true,
        value: { creditNoteId: creditNote.id, status: creditNote.status },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async createRefund(
    input: Parameters<BillingPort["createRefund"]>[0],
  ): ReturnType<BillingPort["createRefund"]> {
    const result = await this.refundPayment({
      paymentIntentId: input.paymentId,
      amount: input.amount,
      reason: "requested_by_customer",
      internalReasonCode: "commerce_refund",
      idempotencyKey: input.idempotencyKey,
    });
    return result.ok
      ? { ok: true, value: { refundId: result.value.refundId } }
      : result;
  }

  public async refundPayment(
    input: Parameters<StripeCommercialGateway["refundPayment"]>[0],
  ): ReturnType<StripeCommercialGateway["refundPayment"]> {
    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: input.paymentIntentId,
          amount: toSafeMinorUnits(input.amount),
          reason: input.reason,
          metadata: { reason_code: input.internalReasonCode },
        },
        requestOptions(input.idempotencyKey, "refund"),
      );
      return {
        ok: true,
        value: { refundId: refund.id, status: status(refund.status) },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async retrieveDispute(
    disputeId: string,
  ): ReturnType<StripeCommercialGateway["retrieveDispute"]> {
    try {
      const dispute = await this.stripe.disputes.retrieve(disputeId);
      return {
        ok: true,
        value: {
          disputeId: dispute.id,
          status: dispute.status,
          ...(dispute.evidence_details.due_by === null ||
          dispute.evidence_details.due_by === 0
            ? {}
            : { evidenceDueAt: isoFromEpoch(dispute.evidence_details.due_by) }),
          amount: MoneySchema.parse({
            currency: dispute.currency.toUpperCase(),
            minor: parseProviderMinorUnits(dispute.amount),
          }),
        },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }

  public async submitDisputeEvidence(
    input: Parameters<StripeCommercialGateway["submitDisputeEvidence"]>[0],
  ): ReturnType<StripeCommercialGateway["submitDisputeEvidence"]> {
    try {
      const dispute = await this.stripe.disputes.update(
        input.disputeId,
        {
          evidence: {
            ...(input.evidence.customerCommunication === undefined
              ? {}
              : {
                  customer_communication: input.evidence.customerCommunication,
                }),
            ...(input.evidence.customerName === undefined
              ? {}
              : { customer_name: input.evidence.customerName }),
            ...(input.evidence.productDescription === undefined
              ? {}
              : { product_description: input.evidence.productDescription }),
            ...(input.evidence.uncategorizedText === undefined
              ? {}
              : { uncategorized_text: input.evidence.uncategorizedText }),
          },
          submit: input.submit,
        },
        requestOptions(input.idempotencyKey, "dispute-evidence"),
      );
      return {
        ok: true,
        value: { disputeId: dispute.id, status: dispute.status },
      };
    } catch (error) {
      return toProviderFailure(error);
    }
  }
}

export type StripeFinanceGatewayResult<T> = ProviderResult<T>;
