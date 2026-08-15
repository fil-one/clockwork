import { createHash, randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { accounts, auditEvents } from "../../schema";
import {
  accountCommercialProfiles,
  accountContacts,
  accountRelationshipRoles,
  billingPolicies,
} from "../../schema/core/finance";
import {
  DatabaseCoreError,
  DatabaseCoreFinanceRepository,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

/**
 * The four account settings commands, against what they write.
 *
 * `add_role`, `add_contact`, `set_payment_terms` and `set_partner_credit` were
 * accepted, audited under their own event type, and bumped the account's row
 * version -- and wrote nothing. All five non-create verbs shared one patch of
 * three optional keys (`legalName`, `invoiceDeliveryEmail`, `billingContact`),
 * so a caller adding a partner role got a 200 and an audit trail saying it
 * happened, over a database in which it had not.
 *
 * Every assertion here reads the row the verb is supposed to have written. A
 * command that returns success and writes nothing fails all four, which is what
 * it did before this work-stream.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const repository = new DatabaseCoreFinanceRepository({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
});

const userId = "20000000-0000-4000-8000-000000000002";
const run = randomUUID().replaceAll("-", "").slice(0, 10);

/**
 * Cobalt Reseller: a SEEDED partner account, with the commercial profile the
 * demo seed writes for it and the aggregate credit limit that profile's
 * approved limit was seeded FROM.
 *
 * The partner-credit tests below have to run against one. A freshly created
 * account has no commercial profile, and that is the single state in which the
 * invariant `core_validate_finance_chain` enforces -- account aggregate limit
 * equals profile approved limit, for accounts holding the partner role --
 * cannot be broken. Testing the verb only against fresh accounts is how a write
 * that breaks the invariant on every seeded partner shipped green.
 */
const seededPartnerAccountId = "10000000-0000-4000-8000-000000000006";

/**
 * The limit the partner is carrying when this file starts, read rather than
 * assumed: the suite shares a database with everything else that runs against
 * it, and what matters is the invariant, not the number the seed happens to
 * hold.
 */
let seededPartnerCreditLimit = 3_000_000n;

beforeAll(async () => {
  const [account] = await db
    .select({ limit: accounts.aggregateCreditLimitMinor })
    .from(accounts)
    .where(eq(accounts.id, seededPartnerAccountId));
  if (!account) throw new Error("the seeded partner account is missing");
  seededPartnerCreditLimit = account.limit;
});

afterAll(async () => {
  // Put the seeded partner back where this file found it, both sides at once --
  // the same rule the command under test follows, for the same reason.
  await db
    .update(accounts)
    .set({ aggregateCreditLimitMinor: seededPartnerCreditLimit })
    .where(eq(accounts.id, seededPartnerAccountId));
  await db
    .update(accountCommercialProfiles)
    .set({ approvedCreditLimitMinor: seededPartnerCreditLimit })
    .where(eq(accountCommercialProfiles.accountId, seededPartnerAccountId));
  await client.end();
});

/** Sends a command to an account that already exists, at its current version. */
async function sendTo(
  accountId: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const [current] = await db
    .select({ rowVersion: accounts.rowVersion })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!current) throw new Error(`no account ${accountId}`);
  await repository.mutate({
    resource: "accounts",
    id: accountId,
    accountId,
    action,
    expectedVersion: current.rowVersion,
    payload,
    actor: { kind: "user", id: ids.user.parse(userId) },
    authorization: {
      userId: ids.user.parse(userId),
      accountIds: [ids.account.parse(accountId)],
      roles: ["owner"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    },
    requestId: `account-commands-${randomUUID()}`,
    idempotencyKey: `account-commands-${randomUUID()}`,
    occurredAt: new Date().toISOString(),
  });
}

/** A fresh account and the version cursor its commands advance. */
async function newAccount(): Promise<{
  id: string;
  authorization: AuthorizationContext;
  send(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<{ rowVersion: number }>;
}> {
  const id = randomUUID();
  const suffix = `${run}-${randomUUID().slice(0, 8)}`;
  const authorization: AuthorizationContext = {
    userId: ids.user.parse(userId),
    accountIds: [ids.account.parse(id)],
    roles: ["owner"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  let version = 0;
  const send = async (action: string, payload: Record<string, unknown>) => {
    const result = await repository.mutate({
      resource: "accounts",
      id,
      accountId: id,
      action,
      ...(version === 0 ? {} : { expectedVersion: version }),
      payload,
      actor: { kind: "user", id: ids.user.parse(userId) },
      authorization,
      requestId: `account-commands-${randomUUID()}`,
      idempotencyKey: `account-commands-${randomUUID()}`,
      occurredAt: new Date().toISOString(),
    });
    version = result.record.rowVersion;
    return { rowVersion: version };
  };
  await send("create", {
    legalName: `Account command probe ${suffix}`,
    relationshipRoles: ["direct_client"],
    registeredAddress: {},
    billingContact: {},
    invoiceDeliveryEmail: `account-commands-${suffix}@probe.invalid`,
    domain: `account-commands-${suffix}.probe.invalid`,
    country: "US",
    currency: "USD",
  });
  return { id, authorization, send };
}

describe("account settings commands", () => {
  it("adds a relationship role to the account and to the role register", async () => {
    const account = await newAccount();
    await account.send("add_role", { role: "partner" });
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(row?.relationshipRoles).toEqual(["direct_client", "partner"]);
    const registered = await db
      .select()
      .from(accountRelationshipRoles)
      .where(eq(accountRelationshipRoles.accountId, account.id));
    expect(registered.map((entry) => entry.role)).toEqual(["partner"]);
  });

  it("refuses a role the account already holds", async () => {
    const account = await newAccount();
    await account.send("add_role", { role: "partner" });
    await expect(
      account.send("add_role", { role: "partner" }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
  });

  it("refuses the partner role to an account whose two credit limits already differ", async () => {
    // The same invariant `set_partner_credit` has to respect, reached from the
    // other side. `core_validate_finance_chain` checks it on the PROFILE, so
    // granting the role to a divergent account is accepted here and fails
    // later -- on the next order acceptance, which is the worst possible place
    // to find out.
    const account = await newAccount();
    await db.insert(accountCommercialProfiles).values({
      accountId: account.id,
      legalEntityFingerprint: createHash("sha256")
        .update(account.id)
        .digest("hex"),
      billingModel: "net_terms",
      paymentTermsDays: 30,
      creditStatus: "approved",
      // Granted through the credit exception queue against a written policy,
      // which is how a non-partner comes to have an approved limit while its
      // aggregate partner limit is still zero.
      approvedCreditLimitMinor: 500_000n,
    });
    await expect(
      account.send("add_role", { role: "partner" }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(row?.relationshipRoles).toEqual(["direct_client"]);

    // And it is allowed the moment the two agree, by exactly the verb the
    // refusal names. A guard that cannot be satisfied is a ban: this one has a
    // way through, and the way through is one command.
    await sendTo(account.id, "set_partner_credit", {
      creditLimit: { currency: "USD", minor: "500000" },
    });
    await sendTo(account.id, "add_role", { role: "partner" });
    const [after] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(after?.relationshipRoles).toEqual(["direct_client", "partner"]);
    const [profile] = await db
      .select()
      .from(accountCommercialProfiles)
      .where(eq(accountCommercialProfiles.accountId, account.id));
    expect(profile?.approvedCreditLimitMinor).toBe(500_000n);
    expect(after?.aggregateCreditLimitMinor).toBe(500_000n);
  });

  it("writes a contact and refuses a second primary of the same kind", async () => {
    const account = await newAccount();
    await account.send("add_contact", {
      kind: "accounts_payable",
      name: "Payables desk",
      email: `ap-${run}@probe.invalid`,
      isPrimary: true,
      receivesInvoices: true,
    });
    const [contact] = await db
      .select()
      .from(accountContacts)
      .where(eq(accountContacts.accountId, account.id));
    expect(contact?.kind).toBe("accounts_payable");
    expect(contact?.receivesInvoices).toBe(true);
    expect(contact?.isPrimary).toBe(true);
    await expect(
      account.send("add_contact", {
        kind: "accounts_payable",
        name: "Second payables desk",
        email: `ap2-${run}@probe.invalid`,
        isPrimary: true,
      }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
    // A non-primary contact of the same kind is ordinary and stays allowed:
    // the refusal above is the unique index, not a ban on second contacts.
    await account.send("add_contact", {
      kind: "accounts_payable",
      name: "Backup payables desk",
      email: `ap3-${run}@probe.invalid`,
    });
    expect(
      await db
        .select()
        .from(accountContacts)
        .where(eq(accountContacts.accountId, account.id)),
    ).toHaveLength(2);
  });

  it("writes the billing policy the payment terms name", async () => {
    const account = await newAccount();
    await account.send("set_payment_terms", {
      collectionMethod: "net_terms",
      paymentRail: "wire",
      termsDays: 45,
      dunningPolicyVersion: "dunning.v1",
      requirePo: true,
    });
    const [policy] = await db
      .select()
      .from(billingPolicies)
      .where(eq(billingPolicies.accountId, account.id));
    expect(policy?.collectionMethod).toBe("net_terms");
    expect(policy?.paymentRail).toBe("wire");
    expect(policy?.termsDays).toBe(45);
    expect(policy?.requirePo).toBe(true);
    // Terms move in place rather than accumulating a second policy row, and a
    // key the second command does not name keeps the value it had.
    await account.send("set_payment_terms", {
      collectionMethod: "auto_charge",
      paymentRail: "card",
    });
    const after = await db
      .select()
      .from(billingPolicies)
      .where(eq(billingPolicies.accountId, account.id));
    expect(after).toHaveLength(1);
    expect(after[0]?.collectionMethod).toBe("auto_charge");
    expect(after[0]?.termsDays).toBeNull();
    expect(after[0]?.dunningPolicyVersion).toBe("dunning.v1");
    expect(after[0]?.requirePo).toBe(true);
  });

  it("refuses a term in days that does not belong to net terms, in either direction", async () => {
    const account = await newAccount();
    await expect(
      account.send("set_payment_terms", {
        collectionMethod: "net_terms",
        paymentRail: "wire",
      }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
    await expect(
      account.send("set_payment_terms", {
        collectionMethod: "auto_charge",
        paymentRail: "card",
        termsDays: 30,
        dunningPolicyVersion: "dunning.v1",
      }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
    // And a first policy with nothing to inherit its dunning version from is
    // refused rather than given one nobody chose.
    await expect(
      account.send("set_payment_terms", {
        collectionMethod: "auto_charge",
        paymentRail: "card",
      }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
    expect(
      await db
        .select()
        .from(billingPolicies)
        .where(eq(billingPolicies.accountId, account.id)),
    ).toEqual([]);
  });

  it("writes both sides of the credit limit on a seeded partner, and leaves the profile writable", async () => {
    // The invariant: `core_validate_finance_chain` refuses a commercial profile
    // whose `approved_credit_limit_minor` differs from the account's
    // `aggregate_credit_limit_minor` when the account holds the partner role.
    // supabase/seed.sql seeds the profile FROM the account column for exactly
    // that reason.
    const [before] = await db
      .select()
      .from(accountCommercialProfiles)
      .where(eq(accountCommercialProfiles.accountId, seededPartnerAccountId));
    expect(before?.approvedCreditLimitMinor).toBe(seededPartnerCreditLimit);
    // A different number from the one it holds, so the assertions below cannot
    // pass by nothing having happened.
    const raised = seededPartnerCreditLimit + 1_000_000n;

    await sendTo(seededPartnerAccountId, "set_partner_credit", {
      creditLimit: { currency: "USD", minor: raised.toString() },
    });

    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, seededPartnerAccountId));
    const [profile] = await db
      .select()
      .from(accountCommercialProfiles)
      .where(eq(accountCommercialProfiles.accountId, seededPartnerAccountId));
    expect(account?.aggregateCreditLimitMinor).toBe(raised);
    // The half that was missing. Writing only the account column succeeded --
    // the trigger is on the profile -- and left the invariant broken behind it.
    expect(profile?.approvedCreditLimitMinor).toBe(raised);

    // The consequence, reproduced. This is verbatim the statement
    // `core_reserve_order_acceptance` issues against the invoicing account and
    // again against the partner account of every accepted order (001000). With
    // the two limits diverged it raised
    // `23514 partner credit limit must match the account aggregate limit`, so
    // one call of this verb on a partner rolled back every subsequent order
    // acceptance for that partner.
    await expect(
      db.execute(
        sql`update core_account_commercial_profiles
            set current_exposure_minor = current_exposure_minor + 100000
            where account_id = ${seededPartnerAccountId}`,
      ),
    ).resolves.toBeDefined();
    await db.execute(
      sql`update core_account_commercial_profiles
          set current_exposure_minor = current_exposure_minor - 100000
          where account_id = ${seededPartnerAccountId}`,
    );
  });

  it("refuses a credit limit stated in another currency", async () => {
    const [before] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, seededPartnerAccountId));
    expect(before?.currency).toBe("USD");
    await expect(
      sendTo(seededPartnerAccountId, "set_partner_credit", {
        creditLimit: { currency: "EUR", minor: "5000000" },
      }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
    const [after] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, seededPartnerAccountId));
    expect(after?.aggregateCreditLimitMinor).toBe(
      before?.aggregateCreditLimitMinor,
    );
  });

  it("refuses a negative credit limit rather than letting a check constraint say it", async () => {
    await expect(
      sendTo(seededPartnerAccountId, "set_partner_credit", {
        creditLimit: { currency: "USD", minor: "-1" },
      }),
    ).rejects.toBeInstanceOf(DatabaseCoreError);
  });

  it("sets a limit on an account that is not a partner yet, because that is how one becomes a partner", async () => {
    // The refusal an earlier draft had here -- "an aggregate credit limit
    // belongs to an account holding the partner role" -- blocked a legitimate
    // write. Together with `add_role`'s divergence guard it meant an account
    // with an approved credit limit could never be made a partner at all. An
    // account with no commercial profile has only one side to write, and the
    // trigger checks the other when the profile is finally inserted.
    const account = await newAccount();
    await account.send("set_partner_credit", {
      creditLimit: { currency: "USD", minor: "5000000" },
    });
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(row?.aggregateCreditLimitMinor).toBe(5_000_000n);
    expect(
      await db
        .select()
        .from(accountCommercialProfiles)
        .where(eq(accountCommercialProfiles.accountId, account.id)),
    ).toEqual([]);
  });

  it("sets the cap and not the credit decision", async () => {
    // Approving credit is the credit exception queue's decision (§9). A partner
    // sitting at `not_requested` still cannot draw on the limit this writes,
    // and the verb saying otherwise would be a receipt for an approval nobody
    // gave.
    const [before] = await db
      .select({ creditStatus: accountCommercialProfiles.creditStatus })
      .from(accountCommercialProfiles)
      .where(eq(accountCommercialProfiles.accountId, seededPartnerAccountId));
    await sendTo(seededPartnerAccountId, "set_partner_credit", {
      creditLimit: { currency: "USD", minor: "4000000" },
    });
    const [after] = await db
      .select({ creditStatus: accountCommercialProfiles.creditStatus })
      .from(accountCommercialProfiles)
      .where(eq(accountCommercialProfiles.accountId, seededPartnerAccountId));
    expect(after?.creditStatus).toBe(before?.creditStatus);
  });

  it("keeps update to the keys it names", async () => {
    const account = await newAccount();
    await account.send("add_role", { role: "partner" });
    await account.send("set_partner_credit", {
      creditLimit: { currency: "USD", minor: "250000" },
    });
    await account.send("update", { legalName: `Renamed probe ${run}` });
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, account.id));
    // `normalizeLegalName` lower-cases and collapses, which `update` still
    // applies -- the assertion is that the rename landed, not how it is spelled.
    expect(row?.legalName).toContain("renamed probe");
    expect(row?.relationshipRoles).toEqual(["direct_client", "partner"]);
    expect(row?.aggregateCreditLimitMinor).toBe(250_000n);
  });

  it("audits each command under its own event and leaves the row it names changed", async () => {
    const account = await newAccount();
    await account.send("add_role", { role: "partner" });
    await account.send("set_partner_credit", {
      creditLimit: { currency: "USD", minor: "125000" },
    });
    const events = await db
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.aggregateType, "account"),
          eq(auditEvents.aggregateId, account.id),
        ),
      );
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "core.accounts.add_role",
      "core.accounts.create",
      "core.accounts.set_partner_credit",
    ]);
    // The point of the assertion above is the pair below: an audit trail is
    // only evidence if the database agrees with it.
    const [row] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, account.id));
    expect(row?.relationshipRoles).toContain("partner");
    expect(row?.aggregateCreditLimitMinor).toBe(125_000n);
  });

  it("refuses a verb no branch implements", async () => {
    // `accounts` used to have no answer that meant "no such verb": every verb
    // reached the shared patch, so an unknown one was accepted. The catalogue
    // guard stops it before dispatch, and the branch refuses it after.
    const account = await newAccount();
    await expect(account.send("archive", {})).rejects.toBeInstanceOf(
      DatabaseCoreError,
    );
  });
});
