import type { SessionClaims } from "@clockwork/api";
import type { InvoiceDerivation } from "@clockwork/db";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCommerceSession: vi.fn(),
  configuredExperienceRepository: vi.fn(),
}));

vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.getCommerceSession,
}));
vi.mock("./demo-experience-repository", () => ({
  configuredExperienceRepository: mocks.configuredExperienceRepository,
}));

import {
  accountIdFromRecordKey,
  derivationScope,
  readAccountDerivations,
} from "./derivation-loader";
import type { ExperienceRepository } from "./repository-port";

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const staffUser = "20000000-0000-4000-8000-000000000001";
const tenantUser = "20000000-0000-4000-8000-000000000002";

function operator(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    userId: staffUser,
    accountIds: [],
    roles: ["internal_operator"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    ...overrides,
  };
}

function customer(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    userId: tenantUser,
    accountIds: [accountA],
    roles: ["billing"],
    isInternalStaff: false,
    mfaVerified: true,
    recentAuthenticationVerified: true,
    ...overrides,
  };
}

function derivation(accountId: string): InvoiceDerivation {
  return {
    invoiceId: "90000000-0000-4000-8000-000000000001",
    reference: "INV-2026-0781",
    accountId,
    orderId: "80000000-0000-4000-8000-000000000001",
    orderReference: "ORD-2026-0098",
    currency: "USD",
    status: "open",
    lines: [],
    derivedTotalMinor: "0",
    invoicedTotalMinor: "0",
    varianceMinor: "0",
    notes: [],
  };
}

function repository(accountId = accountA) {
  const accountInvoiceDerivations = vi.fn(() =>
    Promise.resolve([derivation(accountId)] as readonly InvoiceDerivation[]),
  );
  return {
    repository: {
      accountInvoiceDerivations,
    } as unknown as ExperienceRepository,
    accountInvoiceDerivations,
  };
}

describe("invoice derivation scoping", () => {
  it("reads the account the operator opened", async () => {
    const { repository: fake, accountInvoiceDerivations } = repository();

    const result = await readAccountDerivations(
      {
        session: operator(),
        audience: "internal",
        requestedAccountId: null,
        subjectAccountId: accountA,
        limit: 3,
      },
      fake,
    );

    expect(result.accountId).toBe(accountA);
    expect(result.derivations).toHaveLength(1);
    expect(accountInvoiceDerivations).toHaveBeenCalledWith(
      expect.objectContaining({ userId: staffUser }),
      accountA,
      3,
      expect.stringMatching(/^derivation:/),
    );
  });

  it("refuses a tenant caller asking for an account outside the session", async () => {
    const { repository: fake, accountInvoiceDerivations } = repository();

    await expect(
      readAccountDerivations(
        {
          session: customer(),
          audience: "customer",
          requestedAccountId: null,
          subjectAccountId: accountB,
        },
        fake,
      ),
    ).rejects.toMatchObject({ status: 403, code: "ACCOUNT_SCOPE_FORBIDDEN" });
    expect(accountInvoiceDerivations).not.toHaveBeenCalled();
  });

  it("refuses a forged account parameter from a tenant caller", () => {
    expect(() =>
      derivationScope({
        session: customer(),
        audience: "customer",
        requestedAccountId: accountB,
        subjectAccountId: accountB,
      }),
    ).toThrow("Account access denied");
  });

  it("refuses an account filter forged by an internal caller", () => {
    expect(() =>
      derivationScope({
        session: operator(),
        audience: "internal",
        requestedAccountId: accountB,
        subjectAccountId: accountB,
      }),
    ).toThrow("not a forged account parameter");
  });

  it("refuses the internal audience to a session without internal standing", () => {
    expect(() =>
      derivationScope({
        session: customer(),
        audience: "internal",
        requestedAccountId: null,
        subjectAccountId: accountA,
      }),
    ).toThrow("Internal audience access denied");
  });

  it("pins an assisted operator to the persisted effective account", () => {
    const assisted = operator({
      impersonation: {
        accountId: accountA,
        reason: "Customer requested a billing explanation",
        sessionId: "60000000-0000-4000-8000-000000000001",
        actualUserId: staffUser,
        actualActorEmail: "operator@filone.com",
      },
    });

    expect(
      derivationScope({
        session: assisted,
        audience: "customer",
        requestedAccountId: null,
        subjectAccountId: accountA,
      }),
    ).toBe(accountA);
    expect(() =>
      derivationScope({
        session: assisted,
        audience: "customer",
        requestedAccountId: null,
        subjectAccountId: accountB,
      }),
    ).toThrow("Account access denied");
  });

  it("rejects an account identifier that is not a UUID", () => {
    expect(() => accountIdFromRecordKey("account-not-a-uuid")).toThrow(
      "Account identifier is invalid",
    );
    expect(() =>
      derivationScope({
        session: operator(),
        audience: "internal",
        requestedAccountId: null,
        subjectAccountId: "../../etc/passwd",
      }),
    ).toThrow("Account identifier is invalid");
  });

  it("accepts the projection record key and the bare identifier", () => {
    expect(accountIdFromRecordKey(`account-${accountA}`)).toBe(accountA);
    expect(accountIdFromRecordKey(accountA)).toBe(accountA);
  });
});
