import type { Currency, Money } from "@clockwork/contracts";

export type CommercialRole = "direct_client" | "partner" | "end_client";
export type PaymentTerms =
  | { kind: "prepay" | "auto_charge" }
  | { kind: "net"; days: number; creditApproved: boolean };

export interface CommercialContact {
  name: string;
  email: string;
  phone?: string;
  roles: readonly ("billing" | "accounts_payable" | "procurement" | "legal")[];
}

export interface TaxIdentity {
  jurisdiction: string;
  type: "ein" | "vat" | "gst" | "other";
  value: string;
  validation: "pending" | "valid" | "invalid";
}

export interface CertificateRecord {
  jurisdiction: string;
  certificateId: string;
  kind: "tax_exemption" | "resale";
  expiresOn?: string;
  documentId: string;
}

export interface ProcurementProfile {
  poRequired: boolean;
  apContactEmail?: string;
  invoiceDeliveryEmail: string;
  supplierPortalStatus:
    "not_required" | "not_started" | "in_progress" | "complete" | "blocked";
  certificates: readonly CertificateRecord[];
  furnishedDocuments: readonly {
    kind: "w9" | "w8" | "coi" | "bank_verification" | "other";
    documentId: string;
    furnishedAt: string;
  }[];
}

export interface AccountCommercialRecord {
  id: string;
  legalName: string;
  country: string;
  domain: string;
  roles: readonly CommercialRole[];
  taxIds: readonly TaxIdentity[];
  contacts: readonly CommercialContact[];
  currency: Currency;
  paymentTerms: PaymentTerms;
  procurement: ProcurementProfile;
  partner?: {
    agreementType: "referral" | "resale" | "msp" | "embedded";
    parentPartnerId?: string;
    creditLimit: Money;
    transferTier?: string;
    commissionRateBps?: number;
  };
  rowVersion: number;
}

function requireEmail(value: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error(`Invalid email address: ${value}`);
}

export function normalizeLegalName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(incorporated|inc|limited|ltd|llc|plc|gmbh|sarl|sl|sa)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomain(value: string): string {
  const domain = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^www\./, "");
  if (!/^(?=.{3,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain))
    throw new Error("Invalid account domain");
  return domain;
}

export interface DedupeSignal {
  candidateId: string;
  confidence: "exact_tax_id" | "exact_domain" | "probable_legal_entity";
  reasons: readonly string[];
}

/** Returns review signals; only an exact validated tax ID is safe to auto-link. */
export function findAccountDedupeSignals(
  incoming: Pick<
    AccountCommercialRecord,
    "legalName" | "country" | "domain" | "taxIds"
  >,
  existing: readonly AccountCommercialRecord[],
): DedupeSignal[] {
  const normalizedDomain = normalizeDomain(incoming.domain);
  const normalizedName = normalizeLegalName(incoming.legalName);
  const validTaxIds = new Set(
    incoming.taxIds
      .filter((taxId) => taxId.validation === "valid")
      .map(
        (taxId) =>
          `${taxId.jurisdiction}:${taxId.type}:${taxId.value.replace(/\W/g, "").toUpperCase()}`,
      ),
  );
  return existing.flatMap((candidate) => {
    const reasons: string[] = [];
    const taxMatch = candidate.taxIds.some(
      (taxId) =>
        taxId.validation === "valid" &&
        validTaxIds.has(
          `${taxId.jurisdiction}:${taxId.type}:${taxId.value.replace(/\W/g, "").toUpperCase()}`,
        ),
    );
    if (taxMatch) reasons.push("validated tax identifier matches");
    const domainMatch = normalizeDomain(candidate.domain) === normalizedDomain;
    if (domainMatch) reasons.push("business domain matches");
    const entityMatch =
      candidate.country === incoming.country &&
      normalizeLegalName(candidate.legalName) === normalizedName;
    if (entityMatch) reasons.push("normalized legal name and country match");
    if (reasons.length === 0) return [];
    return [
      {
        candidateId: candidate.id,
        confidence: taxMatch
          ? "exact_tax_id"
          : domainMatch
            ? "exact_domain"
            : "probable_legal_entity",
        reasons,
      } satisfies DedupeSignal,
    ];
  });
}

export function validateAccountCommercialRecord(
  record: AccountCommercialRecord,
): AccountCommercialRecord {
  if (!record.legalName.trim()) throw new Error("Legal name is required");
  if (!/^[A-Z]{2}$/.test(record.country))
    throw new Error("Country must be ISO alpha-2");
  if (
    record.roles.length === 0 ||
    new Set(record.roles).size !== record.roles.length
  )
    throw new Error("Relationship roles must be a non-empty set");
  normalizeDomain(record.domain);
  requireEmail(record.procurement.invoiceDeliveryEmail);
  record.contacts.forEach((contact) => requireEmail(contact.email));
  if (record.procurement.apContactEmail)
    requireEmail(record.procurement.apContactEmail);
  if (record.paymentTerms.kind === "net") {
    if (
      !Number.isInteger(record.paymentTerms.days) ||
      record.paymentTerms.days < 1
    )
      throw new Error("Net payment terms must be a positive whole day count");
    if (!record.paymentTerms.creditApproved)
      throw new Error("Net payment terms require recorded credit approval");
  }
  if (record.roles.includes("partner") !== Boolean(record.partner))
    throw new Error(
      "Partner role and partner commercial profile must be supplied together",
    );
  if (record.partner) {
    if (record.partner.creditLimit.currency !== record.currency)
      throw new Error(
        "Partner credit limit currency must match the account currency",
      );
    if (BigInt(record.partner.creditLimit.minor) < 0n)
      throw new Error("Partner credit limit cannot be negative");
    if (
      record.partner.commissionRateBps !== undefined &&
      (!Number.isInteger(record.partner.commissionRateBps) ||
        record.partner.commissionRateBps < 0 ||
        record.partner.commissionRateBps > 10_000)
    )
      throw new Error(
        "Commission rate must be between 0 and 10000 basis points",
      );
    if (record.partner.parentPartnerId === record.id)
      throw new Error("A partner cannot be its own parent");
  }
  return {
    ...record,
    domain: normalizeDomain(record.domain),
    roles: Object.freeze([...record.roles]),
  };
}

export function procurementReadiness(
  account: AccountCommercialRecord,
  poNumber?: string,
): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (account.procurement.poRequired && !poNumber?.trim())
    missing.push("purchase_order_number");
  if (account.paymentTerms.kind === "net") {
    if (!account.procurement.apContactEmail)
      missing.push("accounts_payable_contact");
    if (
      account.procurement.supplierPortalStatus !== "complete" &&
      account.procurement.supplierPortalStatus !== "not_required"
    )
      missing.push("supplier_portal_setup");
  }
  return { ready: missing.length === 0, missing };
}
