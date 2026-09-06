import { z } from "zod";
import { paygEvidenceHash } from "./index";
import type { PaygOfferRecord } from "./offers";

import type { CustomerAcquisitionPolicy } from "./acquisition-policy";
export * from "./acquisition-policy";

const acceptance = {
  id: z.uuid(),
  accountId: z.uuid(),
  organizationId: z.uuid(),
  offerVersionId: z.uuid(),
  offerRowVersion: z.int().positive(),
  offerFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedTerms: z.literal(true),
};
export const CustomerAcquisitionCommandSchema = z.discriminatedUnion("kind", [
  z.object({ ...acceptance, kind: z.enum(["payg", "trial"]) }).strict(),
  z
    .object({
      ...acceptance,
      kind: z.literal("convert_to_payg"),
      trialId: z.uuid(),
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      accountId: z.uuid(),
      organizationId: z.uuid(),
      kind: z.literal("cancel_payg"),
      enrollmentId: z.uuid(),
      reason: z.string().trim().min(8).max(2000),
    })
    .strict(),
]);
export type CustomerAcquisitionCommand = z.infer<
  typeof CustomerAcquisitionCommandSchema
>;
export const ResolveAcquisitionCommandSchema = z
  .object({
    id: z.uuid(),
    expectedRowVersion: z.int().positive(),
    decision: z.enum(["fulfilled", "declined"]),
    reason: z.string().trim().min(8).max(2000),
    trialId: z.uuid().optional(),
    enrollmentId: z.uuid().optional(),
  })
  .strict();
export type ResolveAcquisitionCommand = z.infer<
  typeof ResolveAcquisitionCommandSchema
>;

export interface CustomerAcquisitionOffer {
  id: string;
  rowVersion: number;
  fingerprint: string;
  name: string;
  sku: string;
  region: string;
  version: number;
  effectiveFrom: string;
  currency: string;
  storageTbMonthMinor: string;
  monthlyMinimumMinor: string;
  partialMonthMinimum: "full" | "prorated";
  trial: PaygOfferRecord["terms"]["trial"];
  notices: CustomerAcquisitionPolicy;
}
export function customerAcquisitionOffer(
  offer: PaygOfferRecord,
  options?: { includeDisabled: boolean },
): CustomerAcquisitionOffer | undefined {
  const notices = offer.terms.customerAcquisition;
  if (
    !notices ||
    (!options?.includeDisabled &&
      !notices.paygRequestsEnabled &&
      !notices.trialRequestsEnabled)
  )
    return undefined;
  return {
    id: offer.id,
    rowVersion: offer.rowVersion,
    fingerprint: paygEvidenceHash(offer.terms),
    name: offer.terms.name,
    sku: offer.terms.sku,
    region: offer.terms.region,
    version: offer.terms.version,
    effectiveFrom: offer.terms.effectiveFrom,
    currency: offer.terms.payg.currency,
    storageTbMonthMinor: offer.terms.payg.storageTbMonthMinor,
    monthlyMinimumMinor: offer.terms.payg.monthlyMinimumMinor,
    partialMonthMinimum: offer.terms.payg.partialMonthMinimum,
    trial: offer.terms.trial,
    notices,
  };
}
export function effectiveCustomerOffers(
  offers: readonly PaygOfferRecord[],
  now: string,
): CustomerAcquisitionOffer[] {
  const current = new Map<string, PaygOfferRecord>();
  for (const offer of offers) {
    if (
      offer.status !== "approved" ||
      !offer.approvalEvidenceId ||
      offer.terms.effectiveFrom > now.slice(0, 10)
    )
      continue;
    const key = `${offer.terms.sku}\0${offer.terms.region}`;
    const prior = current.get(key);
    if (
      !prior ||
      offer.terms.effectiveFrom > prior.terms.effectiveFrom ||
      (offer.terms.effectiveFrom === prior.terms.effectiveFrom &&
        offer.terms.version > prior.terms.version)
    )
      current.set(key, offer);
  }
  return [...current.values()].flatMap((offer) => {
    const publicOffer = customerAcquisitionOffer(offer);
    return publicOffer ? [publicOffer] : [];
  });
}
export interface CustomerAcquisitionRequest {
  id: string;
  accountId: string;
  organizationId: string;
  organizationName: string;
  kind: CustomerAcquisitionCommand["kind"];
  status: "pending" | "fulfilled" | "declined";
  rowVersion: number;
  acceptedAt: string;
  offer: CustomerAcquisitionOffer;
  reason: string;
  resolutionReason: string | null;
  trialId: string | null;
  enrollmentId: string | null;
  result: null | {
    kind: "trial" | "payg";
    id: string;
    startsAt: string;
    endsAt: string | null;
    convertedAt: string | null;
    billingAuthority: string | null;
  };
}
export interface CustomerAcquisitionView {
  offers: CustomerAcquisitionOffer[];
  organizations: {
    id: string;
    name: string;
    canRequest: boolean;
    providerMapped: boolean;
  }[];
  requests: CustomerAcquisitionRequest[];
}
