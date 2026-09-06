import { describe, expect, it } from "vitest";
import {
  assertBootstrapTarget,
  productionBootstrapDigest,
  validateProductionBootstrap,
} from "./production-bootstrap";

const now = new Date("2026-09-06T12:00:00Z");
const person = {
  id: "20000000-0000-4000-8000-000000000001",
  workosUserId: "user_01PRIMARY",
  email: "operator@company.com",
  name: "Operator",
  role: "internal_operator",
  mfaVerifiedAt: "2026-09-06T11:00:00Z",
  mfaEvidence: "urn:clockwork:verified-mfa:primary",
};
const source = {
  schemaVersion: 1,
  id: "94000000-0000-4000-8000-000000000001",
  environment: "production",
  targetDatabaseHost: "database.company.com",
  sourceEvidence: "urn:clockwork:bootstrap:approval",
  operatorUserId: person.id,
  identityVerificationAttestation: "verified_with_identity_provider",
  account: {
    id: "10000000-0000-4000-8000-000000000001",
    legalName: "Company Operations",
    domain: "company.com",
    country: "US",
    currency: "USD",
    registeredAddress: {
      line1: "Approved address",
      city: "City",
      postalCode: "10001",
      country: "US",
    },
    billingContact: { name: "Finance", email: "finance@company.com" },
    apContact: { name: "Finance", email: "finance@company.com" },
    invoiceDeliveryEmail: "finance@company.com",
  },
  organization: {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Staff",
    workosOrganizationId: "org_01COMPANY",
  },
  staff: [
    person,
    {
      ...person,
      id: "20000000-0000-4000-8000-000000000002",
      workosUserId: "user_01FINANCE",
      email: "finance@company.com",
      role: "finance_approver",
    },
  ],
  providerReferences: [],
  catalog: [],
  organizationMappings: [],
};

describe("safe production bootstrap manifest", () => {
  it("validates a reference-only manifest without inventing catalog or provider values", () => {
    const manifest = validateProductionBootstrap(source, now);
    expect(manifest.catalog).toEqual([]);
    expect(productionBootstrapDigest(manifest)).toMatch(/^[a-f0-9]{64}$/);
    expect(productionBootstrapDigest(manifest)).not.toBe(
      productionBootstrapDigest({
        ...manifest,
        sourceEvidence: "urn:clockwork:different-evidence",
      }),
    );
  });
  it("rejects duplicate principals, demo identity and missing distinct finance authority", () => {
    expect(() =>
      validateProductionBootstrap(
        { ...source, staff: [person, { ...person, role: "finance_approver" }] },
        now,
      ),
    ).toThrow("BOOTSTRAP_DUPLICATE_STAFF_IDENTITY");
    expect(() =>
      validateProductionBootstrap(
        {
          ...source,
          staff: source.staff.map((value) => ({
            ...value,
            role: "internal_operator",
          })),
        },
        now,
      ),
    ).toThrow("BOOTSTRAP_DISTINCT_OPERATOR_AND_FINANCE_REQUIRED");
    expect(() =>
      validateProductionBootstrap(
        { ...source, account: { ...source.account, domain: "fiction.test" } },
        now,
      ),
    ).toThrow("BOOTSTRAP_FICTIONAL_IDENTITY_FORBIDDEN");
    expect(() =>
      validateProductionBootstrap(
        {
          ...source,
          staff: [
            { ...person, workosUserId: "local_internal_operator" },
            source.staff[1],
          ],
        },
        now,
      ),
    ).toThrow();
  });
  it("requires recent MFA evidence and refuses manifest secret values", () => {
    expect(() =>
      validateProductionBootstrap(source, new Date("2026-09-08T12:00:00Z")),
    ).toThrow("BOOTSTRAP_CURRENT_MFA_EVIDENCE_REQUIRED");
    expect(() =>
      validateProductionBootstrap(
        { ...source, authorizationSecret: "not-allowed-in-manifest" },
        now,
      ),
    ).toThrow();
    expect(() =>
      validateProductionBootstrap(
        {
          ...source,
          providerReferences: [
            {
              provider: "billing",
              secretReference: "sk_live_NOT_A_REFERENCE",
              secretVersion: "1",
              rotatedAt: now.toISOString(),
              sourceEvidence: "urn:clockwork:rotation",
            },
          ],
        },
        now,
      ),
    ).toThrow();
  });
  it("binds apply to the separately reviewed database host and rejects local production targets", () => {
    const manifest = validateProductionBootstrap(source, now);
    expect(() =>
      assertBootstrapTarget(
        manifest,
        "postgresql://database.company.com/postgres",
        "wrong.company.com",
      ),
    ).toThrow("BOOTSTRAP_TARGET_HOST_MISMATCH");
    expect(() =>
      assertBootstrapTarget(
        manifest,
        "postgresql://database.company.com/postgres",
        "database.company.com",
      ),
    ).not.toThrow();
    expect(() =>
      assertBootstrapTarget(
        { ...manifest, targetDatabaseHost: "127.0.0.1" },
        "postgresql://127.0.0.1/postgres",
        "127.0.0.1",
      ),
    ).toThrow("BOOTSTRAP_PRODUCTION_TARGET_REQUIRED");
  });
});
