import { createHash } from "node:crypto";

import type { Role } from "@clockwork/contracts";

export type RelationshipRole = "direct_client" | "partner" | "end_client";
export type RegistrationStatus =
  "restricted" | "screening_review" | "ready_for_agreements";

export interface LegalEntityRegistration {
  legalName: string;
  country: string;
  registeredAddress: {
    line1: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
  };
  taxIds: readonly { jurisdiction: string; value: string; verified: boolean }[];
  relationshipRoles: readonly RelationshipRole[];
  businessDomain: string;
  registrantEmail: string;
  domainVerification: {
    domain: string;
    method: "dns" | "email" | "workos";
    verifiedAt: string | null;
  };
  screeningDecision: "clear" | "review" | "blocked";
}

export interface RegistrationResult {
  accountKey: string;
  legalName: string;
  relationshipRoles: readonly RelationshipRole[];
  normalizedDomain: string;
  status: RegistrationStatus;
  canTransact: boolean;
}

const consumerDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "outlook.com",
  "proton.me",
  "yahoo.com",
]);

function normalizedDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function registrableMatch(
  emailDomain: string,
  businessDomain: string,
): boolean {
  return (
    emailDomain === businessDomain || emailDomain.endsWith(`.${businessDomain}`)
  );
}

export function registerLegalEntity(
  input: LegalEntityRegistration,
): RegistrationResult {
  const legalName = input.legalName.trim();
  if (legalName.length < 2) throw new Error("LEGAL_NAME_REQUIRED");
  if (input.registeredAddress.country !== input.country)
    throw new Error("REGISTERED_COUNTRY_MISMATCH");
  if (input.registeredAddress.line1.trim().length === 0)
    throw new Error("REGISTERED_ADDRESS_REQUIRED");
  if (input.taxIds.some((taxId) => !taxId.verified))
    throw new Error("TAX_ID_NOT_VERIFIED");

  const roles = [...new Set(input.relationshipRoles)].sort();
  if (roles.length === 0) throw new Error("RELATIONSHIP_ROLE_REQUIRED");

  const domain = normalizedDomain(input.businessDomain);
  const proofDomain = normalizedDomain(input.domainVerification.domain);
  const emailDomain = normalizedDomain(
    input.registrantEmail.split("@")[1] ?? "",
  );
  if (consumerDomains.has(domain)) throw new Error("BUSINESS_DOMAIN_REQUIRED");
  if (!input.domainVerification.verifiedAt || proofDomain !== domain)
    throw new Error("DOMAIN_NOT_VERIFIED");
  if (!registrableMatch(emailDomain, domain))
    throw new Error("REGISTRANT_DOMAIN_MISMATCH");

  const accountKey = createHash("sha256")
    .update(input.country.toUpperCase())
    .update("\0")
    .update(legalName.toLocaleLowerCase("en-US"))
    .update("\0")
    .update(domain)
    .digest("hex");
  const status =
    input.screeningDecision === "blocked"
      ? "restricted"
      : input.screeningDecision === "review"
        ? "screening_review"
        : "ready_for_agreements";
  return {
    accountKey,
    legalName,
    relationshipRoles: roles,
    normalizedDomain: domain,
    status,
    canTransact: status === "ready_for_agreements",
  };
}

export interface MembershipPolicyInput {
  role: Role;
  workosRoleSlugs: readonly string[];
  commerceRoleApproved: boolean;
  mfaPolicyActive: boolean;
  idpMfaEnforced: boolean;
  ssoOrganization: boolean;
  internalStaff: boolean;
}

const privileged = new Set<Role>([
  "owner",
  "admin",
  "partner_admin",
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
]);
const internal = new Set<Role>([
  "internal_operator",
  "finance_approver",
  "legal_approver",
  "destructive_action_approver",
]);

/** WorkOS slugs are deliberately informational; commerce approval grants roles. */
export function evaluateMembershipPolicy(input: MembershipPolicyInput): {
  grant: boolean;
  reason: string;
  ignoredWorkosRoleSlugs: readonly string[];
} {
  if (!input.commerceRoleApproved)
    return {
      grant: false,
      reason: "COMMERCE_APPROVAL_REQUIRED",
      ignoredWorkosRoleSlugs: input.workosRoleSlugs,
    };
  if (internal.has(input.role) !== input.internalStaff)
    return {
      grant: false,
      reason: "STAFF_BOUNDARY",
      ignoredWorkosRoleSlugs: input.workosRoleSlugs,
    };
  if (
    privileged.has(input.role) &&
    !(input.ssoOrganization ? input.idpMfaEnforced : input.mfaPolicyActive)
  )
    return {
      grant: false,
      reason: "MFA_POLICY_REQUIRED",
      ignoredWorkosRoleSlugs: input.workosRoleSlugs,
    };
  return {
    grant: true,
    reason: "APPROVED",
    ignoredWorkosRoleSlugs: input.workosRoleSlugs,
  };
}

export function selectAccount(input: {
  requestedAccountId: string;
  membershipAccountIds: readonly string[];
  currentWorkosOrganizationId: string;
  workosOrganizationByAccount: Readonly<Record<string, string>>;
}): { accountId: string; workosOrganizationId: string } {
  if (!input.membershipAccountIds.includes(input.requestedAccountId))
    throw new Error("ACCOUNT_SCOPE");
  const workosOrganizationId =
    input.workosOrganizationByAccount[input.requestedAccountId];
  if (!workosOrganizationId) throw new Error("WORKOS_ORGANIZATION_NOT_LINKED");
  return { accountId: input.requestedAccountId, workosOrganizationId };
}

export interface NotificationRoute {
  commercialRecipients: readonly string[];
  productRecipients: readonly string[];
  internalRecipients: readonly string[];
}

/** Commercial messages follow the invoicing party; product-required notices may reach users. */
export function routeLifecycleNotification(input: {
  sourcing: "direct" | "referral" | "resale";
  clientContacts: readonly string[];
  partnerContacts: readonly string[];
  endClientProductContacts: readonly string[];
  internalOwner: string;
  kind: "commercial" | "product_required" | "breach";
}): NotificationRoute {
  const partnerOwned = input.sourcing === "resale";
  return {
    commercialRecipients: partnerOwned
      ? [...input.partnerContacts]
      : [...input.clientContacts],
    productRecipients:
      input.kind === "commercial"
        ? []
        : [...new Set(input.endClientProductContacts)],
    internalRecipients: [input.internalOwner],
  };
}

export function assistedActionEvidence(input: {
  actualActorId: string;
  effectiveActorId: string;
  accountId: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
}): Readonly<typeof input> {
  if (input.actualActorId === input.effectiveActorId)
    throw new Error("ASSISTED_ACTOR_MUST_BE_DISTINCT");
  if (input.reason.trim().length < 8)
    throw new Error("ASSISTED_ACTION_REASON_REQUIRED");
  if (Date.parse(input.expiresAt) <= Date.parse(input.startedAt))
    throw new Error("ASSISTED_ACTION_EXPIRY_INVALID");
  return Object.freeze({ ...input, reason: input.reason.trim() });
}

export interface ProcurementTask {
  id: string;
  kind:
    | "collect_ap_contact"
    | "configure_invoice_delivery"
    | "collect_exemption_certificate"
    | "furnish_supplier_document"
    | "buyer_supplier_portal";
  ownerId: string;
  status: "open" | "complete" | "blocked";
  dueAt: string;
  reminderEveryHours: number;
  completedAt: string | null;
  waiver?: {
    waivedBy: string;
    waivedAt: string;
    reason: string;
    evidenceHash: string;
  };
}

const procurementEvidenceHashPattern = /^[a-f0-9]{64}$/;

function hasValidProcurementWaiver(task: ProcurementTask): boolean {
  const waiver = task.waiver;
  return Boolean(
    waiver &&
    waiver.waivedBy.trim().length > 0 &&
    Number.isFinite(Date.parse(waiver.waivedAt)) &&
    waiver.reason.trim().length >= 8 &&
    procurementEvidenceHashPattern.test(waiver.evidenceHash),
  );
}

export function evaluateProcurementOnboarding(input: {
  paymentTerms: "auto_charge" | "net_terms";
  apContactEmail: string | null;
  invoiceDeliveryEmail: string | null;
  poRequired: boolean;
  exemptionRequired: boolean;
  validExemptionCertificate: boolean;
  requiredSupplierDocuments: readonly string[];
  furnishedSupplierDocuments: readonly string[];
  supplierPortalRequired: boolean;
  supplierPortalComplete: boolean;
  tasks: readonly ProcurementTask[];
}): {
  complete: boolean;
  blockers: readonly string[];
  openTasks: readonly string[];
  waivedTasks: readonly string[];
} {
  const blockers: string[] = [];
  if (input.paymentTerms === "net_terms" && !input.apContactEmail)
    blockers.push("AP_CONTACT_REQUIRED");
  if (!input.invoiceDeliveryEmail) blockers.push("INVOICE_DELIVERY_REQUIRED");
  if (input.exemptionRequired && !input.validExemptionCertificate)
    blockers.push("VALID_EXEMPTION_CERTIFICATE_REQUIRED");
  const missingDocuments = input.requiredSupplierDocuments.filter(
    (document) => !input.furnishedSupplierDocuments.includes(document),
  );
  if (missingDocuments.length > 0)
    blockers.push(`SUPPLIER_DOCUMENTS_MISSING:${missingDocuments.join(",")}`);
  if (input.supplierPortalRequired && !input.supplierPortalComplete)
    blockers.push("BUYER_SUPPLIER_PORTAL_INCOMPLETE");
  const openTasks = input.tasks
    .filter(
      (task) => task.status !== "complete" && !hasValidProcurementWaiver(task),
    )
    .map((task) => task.id);
  const waivedTasks = input.tasks
    .filter(
      (task) => task.status !== "complete" && hasValidProcurementWaiver(task),
    )
    .map((task) => task.id);
  if (
    input.tasks.some(
      (task) =>
        !task.id.trim() ||
        !task.ownerId.trim() ||
        !Number.isFinite(Date.parse(task.dueAt)) ||
        !Number.isFinite(task.reminderEveryHours) ||
        task.reminderEveryHours <= 0 ||
        (task.status === "complete" &&
          !Number.isFinite(Date.parse(task.completedAt ?? ""))),
    )
  )
    blockers.push("PROCUREMENT_TASK_OWNERSHIP_INVALID");
  if (
    input.tasks.some((task) => task.waiver && !hasValidProcurementWaiver(task))
  )
    blockers.push("PROCUREMENT_TASK_WAIVER_EVIDENCE_INVALID");
  if (openTasks.length > 0)
    blockers.push(`PROCUREMENT_TASKS_OPEN:${openTasks.join(",")}`);
  return {
    complete: blockers.length === 0,
    blockers,
    openTasks,
    waivedTasks,
  };
}

export interface BrandingPolicy {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  invitationFromName: string;
  customDomain: string | null;
  communicationOwner: "fil_one" | "partner";
  fallbackApplied: boolean;
}

export function resolvePartnerBranding(input: {
  partnerName: string;
  requestedLogoUrl?: string;
  requestedPrimaryColor?: string;
  customDomain?: string;
  customDomainVerified: boolean;
  partnerOwnsCommercialCommunications: boolean;
}): BrandingPolicy {
  const domain = input.customDomain
    ? normalizedDomain(input.customDomain)
    : undefined;
  const customizationValid =
    Boolean(domain && input.customDomainVerified) &&
    Boolean(input.requestedLogoUrl) &&
    /^#[0-9a-f]{6}$/i.test(input.requestedPrimaryColor ?? "");
  if (!customizationValid)
    return {
      brandName: "Fil One",
      logoUrl: null,
      primaryColor: "#171717",
      invitationFromName: "Fil One",
      customDomain: null,
      communicationOwner: input.partnerOwnsCommercialCommunications
        ? "partner"
        : "fil_one",
      fallbackApplied: true,
    };
  return {
    brandName: input.partnerName.trim(),
    logoUrl: input.requestedLogoUrl ?? null,
    primaryColor: input.requestedPrimaryColor ?? "#171717",
    invitationFromName: input.partnerName.trim(),
    customDomain: domain ?? null,
    communicationOwner: input.partnerOwnsCommercialCommunications
      ? "partner"
      : "fil_one",
    fallbackApplied: false,
  };
}
