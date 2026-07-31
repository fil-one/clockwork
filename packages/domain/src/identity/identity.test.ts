import { describe, expect, it } from "vitest";

import {
  assistedActionEvidence,
  evaluateMembershipPolicy,
  evaluateProcurementOnboarding,
  registerLegalEntity,
  resolvePartnerBranding,
  routeLifecycleNotification,
  selectAccount,
} from ".";

const registration = {
  legalName: "Northstar Archive Ltd",
  country: "GB",
  registeredAddress: {
    line1: "1 Archive Way",
    city: "London",
    postalCode: "EC1A 1AA",
    country: "GB",
  },
  taxIds: [{ jurisdiction: "GB", value: "GB12345", verified: true }],
  relationshipRoles: ["direct_client", "partner"] as const,
  businessDomain: "northstar.test",
  registrantEmail: "owner@northstar.test",
  domainVerification: {
    domain: "northstar.test",
    method: "dns" as const,
    verifiedAt: "2026-07-31T16:00:00.000Z",
  },
  screeningDecision: "clear" as const,
};

describe("identity and onboarding policy", () => {
  it("creates one stable legal-entity key with role sets", () => {
    const result = registerLegalEntity(registration);
    expect(result.relationshipRoles).toEqual(["direct_client", "partner"]);
    expect(result.accountKey).toHaveLength(64);
    expect(result.canTransact).toBe(true);
  });

  it("blocks consumer domains and restricted parties", () => {
    expect(() =>
      registerLegalEntity({
        ...registration,
        businessDomain: "gmail.com",
        registrantEmail: "buyer@gmail.com",
        domainVerification: {
          ...registration.domainVerification,
          domain: "gmail.com",
        },
      }),
    ).toThrow("BUSINESS_DOMAIN_REQUIRED");
    expect(
      registerLegalEntity({ ...registration, screeningDecision: "blocked" }),
    ).toMatchObject({ status: "restricted", canTransact: false });
  });

  it("does not translate WorkOS role slugs into commerce authority", () => {
    expect(
      evaluateMembershipPolicy({
        role: "owner",
        workosRoleSlugs: ["owner"],
        commerceRoleApproved: false,
        mfaPolicyActive: true,
        idpMfaEnforced: false,
        ssoOrganization: false,
        internalStaff: false,
      }),
    ).toMatchObject({ grant: false, reason: "COMMERCE_APPROVAL_REQUIRED" });
    expect(
      evaluateMembershipPolicy({
        role: "partner_admin",
        workosRoleSlugs: [],
        commerceRoleApproved: true,
        mfaPolicyActive: false,
        idpMfaEnforced: false,
        ssoOrganization: false,
        internalStaff: false,
      }),
    ).toMatchObject({ grant: false, reason: "MFA_POLICY_REQUIRED" });
  });

  it("scopes account switching to approved memberships", () => {
    expect(() =>
      selectAccount({
        requestedAccountId: "account-2",
        membershipAccountIds: ["account-1"],
        currentWorkosOrganizationId: "workos-1",
        workosOrganizationByAccount: { "account-1": "workos-1" },
      }),
    ).toThrow("ACCOUNT_SCOPE");
  });

  it("preserves distinct actual/effective actors for assisted operation", () => {
    expect(
      assistedActionEvidence({
        actualActorId: "operator-1",
        effectiveActorId: "customer-1",
        accountId: "account-1",
        reason: "Customer requested back-office onboarding",
        startedAt: "2026-07-31T16:00:00.000Z",
        expiresAt: "2026-07-31T16:15:00.000Z",
      }),
    ).toMatchObject({
      actualActorId: "operator-1",
      effectiveActorId: "customer-1",
    });
  });

  it("requires the complete procurement profile for terms orders", () => {
    expect(
      evaluateProcurementOnboarding({
        paymentTerms: "net_terms",
        apContactEmail: null,
        invoiceDeliveryEmail: "invoices@northstar.test",
        poRequired: true,
        exemptionRequired: true,
        validExemptionCertificate: false,
        requiredSupplierDocuments: ["w8", "coi"],
        furnishedSupplierDocuments: ["w8"],
        supplierPortalRequired: true,
        supplierPortalComplete: false,
        tasks: [],
      }),
    ).toMatchObject({
      complete: false,
      blockers: [
        "AP_CONTACT_REQUIRED",
        "VALID_EXEMPTION_CERTIFICATE_REQUIRED",
        "SUPPLIER_DOCUMENTS_MISSING:coi",
        "BUYER_SUPPLIER_PORTAL_INCOMPLETE",
      ],
    });
  });

  it("requires every procurement task to be completed or evidence-waived", () => {
    const openTask = {
      id: "supplier-portal-profile",
      kind: "buyer_supplier_portal" as const,
      ownerId: "procurement-owner",
      status: "open" as const,
      dueAt: "2026-08-05T16:00:00.000Z",
      reminderEveryHours: 24,
      completedAt: null,
    };
    const profile = {
      paymentTerms: "net_terms" as const,
      apContactEmail: "ap@northstar.test",
      invoiceDeliveryEmail: "invoices@northstar.test",
      poRequired: false,
      exemptionRequired: false,
      validExemptionCertificate: false,
      requiredSupplierDocuments: [],
      furnishedSupplierDocuments: [],
      supplierPortalRequired: false,
      supplierPortalComplete: false,
      tasks: [openTask],
    };
    expect(evaluateProcurementOnboarding(profile)).toMatchObject({
      complete: false,
      openTasks: ["supplier-portal-profile"],
      blockers: ["PROCUREMENT_TASKS_OPEN:supplier-portal-profile"],
    });
    expect(
      evaluateProcurementOnboarding({
        ...profile,
        tasks: [
          {
            ...openTask,
            waiver: {
              waivedBy: "legal-1",
              waivedAt: "2026-08-01T16:00:00.000Z",
              reason: "Buyer has no supplier portal requirement",
              evidenceHash: "a".repeat(64),
            },
          },
        ],
      }),
    ).toMatchObject({
      complete: true,
      openTasks: [],
      waivedTasks: ["supplier-portal-profile"],
    });
  });

  it("never sends resale commercial messages to the end client", () => {
    const route = routeLifecycleNotification({
      sourcing: "resale",
      clientContacts: ["end-client@northstar.test"],
      partnerContacts: ["renewals@partner.test"],
      endClientProductContacts: ["admin@northstar.test"],
      internalOwner: "owner@filone.test",
      kind: "commercial",
    });
    expect(route.commercialRecipients).toEqual(["renewals@partner.test"]);
    expect(route.productRecipients).toEqual([]);
  });

  it("falls back safely when white-label domain proof is incomplete", () => {
    expect(
      resolvePartnerBranding({
        partnerName: "Partner Cloud",
        requestedLogoUrl: "https://partner.test/logo.png",
        requestedPrimaryColor: "#123456",
        customDomain: "portal.partner.test",
        customDomainVerified: false,
        partnerOwnsCommercialCommunications: true,
      }),
    ).toMatchObject({
      brandName: "Fil One",
      customDomain: null,
      communicationOwner: "partner",
      fallbackApplied: true,
    });
  });
});
