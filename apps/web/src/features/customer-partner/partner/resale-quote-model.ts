import { uuidV7 } from "@clockwork/contracts";

export const offerOptions = [
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "US committed archive · USD 2026.3",
  },
  {
    id: "44444444-4444-4444-8444-444444444445",
    name: "EU committed archive · EUR 2026.2",
  },
  {
    id: "44444444-4444-4444-8444-444444444446",
    name: "UK committed archive · GBP 2026.1",
  },
] as const;

export const clientOptions = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Halcyon Research Cooperative",
  },
  { id: "33333333-3333-4333-8333-333333333334", name: "Solace Public Records" },
  { id: "33333333-3333-4333-8333-333333333335", name: "Atlas Field Imaging" },
] as const;

export interface ResaleQuoteDraft {
  offerName: string;
  region: string;
  capacity: string;
  termMonths: string;
  route: "resale" | "distributor";
  endClientName: string;
  expiresAt: string;
  resalePrice: string;
}

export type QuoteDraftField = keyof ResaleQuoteDraft;
export type QuoteValidation = Partial<Record<QuoteDraftField, string>>;

export function resolveSelectorId(
  name: string,
  options: readonly { id: string; name: string }[],
): string | undefined {
  return options.find(
    (option) =>
      option.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  )?.id;
}

export function validateResaleQuoteStage(
  stage: 1 | 2 | 3,
  draft: ResaleQuoteDraft,
  now = new Date(),
): QuoteValidation {
  const errors: QuoteValidation = {};
  if (stage >= 1) {
    if (!resolveSelectorId(draft.offerName, offerOptions))
      errors.offerName = "Select an available offer by name.";
    if (!draft.region) errors.region = "Select a service region.";
  }
  if (stage >= 2) {
    const capacity = Number(draft.capacity);
    if (!Number.isFinite(capacity) || capacity < 10)
      errors.capacity = "Enter at least 10 TB of committed capacity.";
    const termMonths = Number(draft.termMonths);
    if (!Number.isInteger(termMonths) || termMonths < 1)
      errors.termMonths = "Enter a whole term of at least one month.";
    if (!resolveSelectorId(draft.endClientName, clientOptions))
      errors.endClientName = "Select a registered end client by name.";
    const expiry = Date.parse(draft.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now.getTime())
      errors.expiresAt = "Choose an expiry after the current time.";
    const resaleMinor = Math.round(Number(draft.resalePrice) * 100);
    if (!Number.isSafeInteger(resaleMinor) || resaleMinor <= 0)
      errors.resalePrice = "Enter a positive partner resale price.";
  }
  return errors;
}

export function quoteReviewSummary(draft: ResaleQuoteDraft): readonly string[] {
  return [
    `${draft.endClientName} · ${draft.route === "distributor" ? "Two-tier distributor" : "Resale"}`,
    `${draft.capacity} TB in ${draft.region} for ${draft.termMonths} months`,
    `Partner resale price: $${Number(draft.resalePrice || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    `Quote expires ${draft.expiresAt ? new Date(draft.expiresAt).toLocaleString("en-US") : "after selection"}`,
    "The authoritative transfer price is calculated from the selected price book.",
  ];
}

export function resaleQuotePayload(draft: ResaleQuoteDraft) {
  const priceBookId = resolveSelectorId(draft.offerName, offerOptions);
  const endClientAccountId = resolveSelectorId(
    draft.endClientName,
    clientOptions,
  );
  if (!priceBookId || !endClientAccountId)
    throw new Error("Quote selectors have not been resolved.");
  return {
    priceBookId,
    seriesId: uuidV7(),
    route: draft.route,
    endClientAccountId,
    partnerAccountId: "22222222-2222-4222-8222-222222222222",
    lines: [
      {
        lineId: uuidV7(),
        sku: "FIL-ARCHIVE-CAPACITY",
        region: draft.region,
        quantity: draft.capacity,
        termMonths: Number(draft.termMonths),
      },
    ],
    partnerResaleTotal: {
      currency: draft.offerName.includes("EUR")
        ? "EUR"
        : draft.offerName.includes("GBP")
          ? "GBP"
          : "USD",
      minor: String(Math.round(Number(draft.resalePrice) * 100)),
    },
    expiresAt: new Date(draft.expiresAt).toISOString(),
  };
}
