import { uuidV7 } from "@clockwork/contracts";

import { customerPartnerCopy } from "../copy";

export const quoteStageLabels = customerPartnerCopy.commercial.quoteStages;

export type QuoteStage = 1 | 2 | 3;
export type QuoteStatus = "draft" | "open" | "accepted" | "canceled";

export interface SelectorOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuoteDraft {
  account: string;
  offer: string;
  region: string;
  capacity: string;
  termMonths: string;
  route: string;
  endClient: string;
  partner: string;
  expiresAt: string;
}

export type QuoteField = keyof QuoteDraft;
export type QuoteErrors = Partial<Record<QuoteField, string>>;

export const quoteSelectorOptions = {
  accounts: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      label: "Northstar Archive Labs",
      description: "Direct customer · United States",
    },
  ],
  offers: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      label: "Enterprise archive capacity",
      description: "FIL-ARCHIVE-CAPACITY · USD 2026.3",
    },
    {
      id: "44444444-4444-4444-8444-444444444445",
      label: "Compliance replica capacity",
      description: "FIL-REPLICA-CAPACITY · USD 2026.3",
    },
  ],
  endClients: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      label: "Halcyon Research Cooperative",
      description: "End client · United States",
    },
  ],
  partners: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      label: "Meridian Channel Group",
      description: "Authorized reseller",
    },
  ],
} as const satisfies Record<string, readonly SelectorOption[]>;

export function resolveSelectorId(
  input: string,
  options: readonly SelectorOption[],
): string | undefined {
  const normalized = input.trim().toLocaleLowerCase();
  return options.find(
    (option) =>
      option.id.toLocaleLowerCase() === normalized ||
      option.label.toLocaleLowerCase() === normalized,
  )?.id;
}

export function validateQuoteStage(
  stage: QuoteStage,
  draft: QuoteDraft,
): QuoteErrors {
  const errors: QuoteErrors = {};
  if (stage === 1) {
    if (!resolveSelectorId(draft.account, quoteSelectorOptions.accounts))
      errors.account = "Choose a customer from the available accounts.";
    if (!resolveSelectorId(draft.offer, quoteSelectorOptions.offers))
      errors.offer = "Choose an offer from the current price book.";
    if (!draft.region) errors.region = "Choose the service data region.";
  }
  if (stage === 2) {
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 10)
      errors.capacity = "Enter a committed capacity of at least 10 TB.";
    const term = Number(draft.termMonths);
    if (!Number.isInteger(term) || term < 1 || term > 60)
      errors.termMonths = "Enter a term between 1 and 60 months.";
    if (!draft.route) errors.route = "Choose a commercial route.";
    if (
      draft.route !== "direct" &&
      !resolveSelectorId(draft.endClient, quoteSelectorOptions.endClients)
    )
      errors.endClient = "Choose the end client for this routed quote.";
    if (
      ["resale", "referral", "distributor"].includes(draft.route) &&
      !resolveSelectorId(draft.partner, quoteSelectorOptions.partners)
    )
      errors.partner = "Choose the partner responsible for this route.";
    const expiry = new Date(draft.expiresAt);
    if (!draft.expiresAt || Number.isNaN(expiry.valueOf()))
      errors.expiresAt = "Enter the date and time when this quote expires.";
  }
  return errors;
}

export function firstQuoteError(errors: QuoteErrors): QuoteField | undefined {
  const order: QuoteField[] = [
    "account",
    "offer",
    "region",
    "capacity",
    "termMonths",
    "route",
    "endClient",
    "partner",
    "expiresAt",
  ];
  return order.find((field) => Boolean(errors[field]));
}

export function quotePayload(draft: QuoteDraft) {
  const priceBookId = resolveSelectorId(
    draft.offer,
    quoteSelectorOptions.offers,
  );
  const accountId = resolveSelectorId(
    draft.account,
    quoteSelectorOptions.accounts,
  );
  const endClientAccountId = resolveSelectorId(
    draft.endClient,
    quoteSelectorOptions.endClients,
  );
  const partnerAccountId = resolveSelectorId(
    draft.partner,
    quoteSelectorOptions.partners,
  );
  return {
    accountId,
    payload: {
      priceBookId,
      seriesId: uuidV7(),
      route: draft.route,
      ...(endClientAccountId ? { endClientAccountId } : {}),
      ...(partnerAccountId ? { partnerAccountId } : {}),
      lines: [
        {
          lineId: uuidV7(),
          sku:
            priceBookId === "44444444-4444-4444-8444-444444444445"
              ? "FIL-REPLICA-CAPACITY"
              : "FIL-ARCHIVE-CAPACITY",
          region: draft.region,
          quantity: draft.capacity,
          termMonths: Number(draft.termMonths),
        },
      ],
      expiresAt: new Date(draft.expiresAt).toISOString(),
    },
  };
}

export function validQuoteActions(status: QuoteStatus): readonly string[] {
  if (status === "draft") return ["edit", "issue", "cancel"];
  if (status === "open") return ["accept", "cancel"];
  if (status === "accepted") return ["create_order"];
  return [];
}

export interface OrderReviewSummary {
  quote: string;
  agreement: string;
  purchaseOrder: string;
  serviceStart: string;
  commitment: string;
}

export function orderReviewSummary(input: {
  quoteTitle: string;
  quoteVersion: string;
  agreementTitle: string;
  agreementVersion: string;
  poNumber?: string;
  serviceStart: string;
  capacity: string;
  spend: string;
}): OrderReviewSummary {
  return {
    quote: `${input.quoteTitle} · version ${input.quoteVersion} · accepted`,
    agreement: `${input.agreementTitle} · version ${input.agreementVersion} · active`,
    purchaseOrder: input.poNumber || "No purchase order supplied",
    serviceStart: input.serviceStart,
    commitment: `${input.capacity} committed · ${input.spend} estimated annual spend`,
  };
}
