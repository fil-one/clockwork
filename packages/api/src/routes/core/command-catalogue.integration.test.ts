import { randomUUID } from "node:crypto";

import { ids } from "@clockwork/contracts";
import { createRuntimeDatabase } from "@clockwork/db";
import { databaseCoreCommands, FixtureTaxPort } from "@clockwork/db/core";
import {
  accounts,
  agreements,
  commerceUsers,
  commissionAccruals,
  dealRegistrations,
  documents,
  invoices,
  orders,
  payments,
  priceBooks,
  procurementProfiles,
  quoteCommercialProfiles,
  quoteLines,
  quotes,
} from "@clockwork/db/schema";
import type { AuthorizationContext } from "@clockwork/domain";
import { beforeAll, describe, expect, it } from "vitest";

import { DatabaseCoreFinanceService } from "../../runtime/database-core-finance-service";
import {
  coreCommandCatalogue,
  coreResourceNames,
  CoreServiceError,
  type CoreResourceName,
} from "./service";

/**
 * Every advertised verb reaches a branch.
 *
 * That is the whole property, and it is stated behaviourally because P0-59 has
 * been shipped three times as something else. It first shipped as three
 * hand-maintained lists -- the portal's action list, this API's catalogue, and
 * `databaseCoreCommands` -- asserted equal to each other; a verb invented in
 * all three passed, because agreement between declarations says nothing about
 * code. It then shipped twice as a comparison against the answer a resource
 * gives a verb that does not exist, which needed the answers made comparable,
 * which needed the verb's own name masked out of them, which grew an escape
 * hatch for the resources the mask could not make comparable. Both rounds of
 * that machinery are gone. What replaced it:
 *
 *   for each advertised verb, invoke it against the running repository and
 *   require the answer to be anything other than "this resource has no branch
 *   for that verb".
 *
 * A validation error, a not-found, a duplicate, a version conflict, an audit
 * refusal and a success all pass, because all of them prove execution reached
 * code that had something to say about this particular verb. Only the literal
 * missing-verb refusal fails. Nothing here can be satisfied by declaring
 * something, which is the point.
 *
 * The set this file refuses is therefore exactly one string per (resource,
 * verb): the resource's own missing-verb refusal, written out in
 * `missingVerbRefusal` below and compared by equality. It is not a heuristic,
 * not a substring search and not a mask, so it cannot invent a difference and
 * cannot report a verb unimplemented for any reason except that the repository
 * said so in those words. Those words are not guessed either -- "the
 * repository's missing-verb refusal is what it says it is" below injects a verb
 * that certainly does not exist into each resource and asserts the repository
 * answers with the declared string, so wording drift in
 * `database-finance.ts` fails this file loudly instead of quietly making it
 * vacuous.
 *
 * Two honest gaps, named rather than papered over:
 *
 * 1. `accounts` has no missing-verb refusal at all: `mutateAccount` branches on
 *    `create` and then stops, so an unknown verb reaches the same shared patch
 *    every other verb reaches. There is nothing to compare against, so the
 *    behavioural check is vacuous for that one resource. It is listed by name
 *    in `resourcesWithNoMissingVerbRefusal` with that reason, and the two lists
 *    must partition `coreResourceNames`, so a new resource cannot join it
 *    silently.
 *
 * 2. `exercisedVerbs` is written out per resource rather than read from the
 *    catalogue, and it plus `unexercisableVerbs` must partition the catalogue
 *    exactly. That is what stops a verb being added to the catalogue and slid
 *    past this file -- particularly on `accounts`, where gap 1 means invoking
 *    an invented verb proves nothing. Every name in `exercisedVerbs` is
 *    actually invoked below; it is a list of work done, not a list of claims.
 *    `unexercisableVerbs` is empty today and every entry it could gain needs a
 *    written reason of its own.
 */

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const authorizationSecret =
  process.env.AUTHORIZATION_CONTEXT_SECRET ??
  "clockwork-local-auth-context-secret-change-me";

const { db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const service = new DatabaseCoreFinanceService({
  database: db,
  pricingDatabase: db,
  authorizationSecret,
  tax: new FixtureTaxPort(),
});

/**
 * A verb no branch can match, used only to check that the strings declared in
 * `missingVerbRefusal` are still the strings the repository produces. It is
 * injected into `databaseCoreCommands` for the length of one call so the
 * repository's command guard lets it through to the resource, which is the
 * code whose verb-awareness the declaration describes.
 */
const ABSENT_VERB = "__catalogue_probe_verb_that_does_not_exist__";

/**
 * Seeded active USD book and one of its rate cards. The quote probe needs a
 * book that still verifies as active and lines that resolve inside it; both are
 * fixed ids in `supabase/seed.sql`, so this does not depend on what any other
 * suite happens to have left behind. Neither row is written by the probe.
 */
const seededPriceBookId = "60000000-0000-4000-8000-000000000001";
const seededRateCardId = "61000000-0000-4000-8000-000000000001";

const run = randomUUID().replaceAll("-", "").slice(0, 10);
const fixture = {
  userId: randomUUID(),
  accountId: randomUUID(),
  endClientAccountId: randomUUID(),
  priceBookId: randomUUID(),
  quoteId: randomUUID(),
  dealRegistrationId: randomUUID(),
  procurementProfileId: randomUUID(),
  commissionPartnerAccountId: randomUUID(),
  commissionBuyerAccountId: randomUUID(),
  commissionDocumentId: randomUUID(),
  commissionAgreementId: randomUUID(),
  commissionQuoteId: randomUUID(),
  commissionOrderId: randomUUID(),
  commissionInvoiceId: randomUUID(),
  commissionPaymentId: randomUUID(),
  commissionAccrualId: randomUUID(),
};

/** UTC quarter of `commissionPaidAt`, which the accrual row must agree with. */
const commissionPaidAt = new Date("2026-08-14T00:00:00.000Z");
const commissionPeriod = "2026-Q3";

/**
 * Rows a probe needs to get past the record lookup that precedes the verb
 * branch. Everything here is created for this run and never mutated by the
 * probe: every advertised verb fails before it writes, and the probes that do
 * reach a write -- the `accounts` patch, `approve` and `reject` on a deal
 * registration -- are refused at the audit event by the roles in `mutation`,
 * which rolls their transaction back.
 */
async function seed(): Promise<void> {
  await db.insert(commerceUsers).values({
    id: fixture.userId,
    workosUserId: `catalogue-probe-${run}`,
    email: `catalogue-probe-${run}@probe.invalid`,
    name: "Command catalogue probe",
    isInternalStaff: true,
  });
  for (const [id, role] of [
    [fixture.accountId, "partner"],
    [fixture.endClientAccountId, "client"],
  ] as const)
    await db.insert(accounts).values({
      id,
      legalName: `Command catalogue probe ${run} ${role}`,
      relationshipRoles: ["partner"],
      registeredAddress: {},
      billingContact: {},
      apContact: {},
      invoiceDeliveryEmail: `${role}-${run}@probe.invalid`,
      domain: `${role}-${run}.probe.invalid`,
      country: "US",
      currency: "USD",
    });
  // Draft, and in a currency/version slot of its own, so probing it can never
  // disturb the seeded active books the rest of the suite prices against.
  await db.insert(priceBooks).values({
    id: fixture.priceBookId,
    name: `Command catalogue probe ${run}`,
    currency: "GBP",
    effectiveFrom: "2026-01-01",
    status: "draft",
    version: 500_000 + Math.floor(Math.random() * 400_000),
  });
  await db.insert(quotes).values({
    id: fixture.quoteId,
    accountId: fixture.accountId,
    priceBookId: seededPriceBookId,
    seriesId: randomUUID(),
    revision: 1,
    status: "draft",
    currency: "USD",
    totalMinor: 180_000n,
    marginFloorResult: "pass",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    createdBy: fixture.userId,
  });
  // Priced against the seeded rate card, because the snapshot the quote verbs
  // are evaluated on resolves every line to a card in the book above.
  await db.insert(quoteLines).values({
    quoteId: fixture.quoteId,
    rateCardId: seededRateCardId,
    sku: "LOCKED-STORAGE-TB",
    quantity: "1",
    termMonths: 12,
    unitPriceMinor: 15_000n,
    overageRateMinor: 18_000n,
    lineTotalMinor: 180_000n,
  });
  // A quote without its commercial profile is refused before any verb branch
  // runs, which would make every quote verb look unimplemented.
  await db.insert(quoteCommercialProfiles).values({
    quoteId: fixture.quoteId,
    channelShape: "direct",
    merchantOfRecord: "fil_one",
    pricingAuthority: "fil_one",
    billingAccountId: fixture.accountId,
    pricingInputs: { exceptionReasons: [] },
    pricingCalculatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await db.insert(dealRegistrations).values({
    id: fixture.dealRegistrationId,
    partnerAccountId: fixture.accountId,
    endClientAccountId: fixture.endClientAccountId,
    workload: "catalogue-probe",
    expectedVolume: "1",
    status: "registered",
    protectionStartsAt: new Date("2026-01-01T00:00:00.000Z"),
    protectionEndsAt: new Date("2027-01-01T00:00:00.000Z"),
  });
  await db.insert(procurementProfiles).values({
    id: fixture.procurementProfileId,
    accountId: fixture.accountId,
  });
  await seedCommissionSource();
}

/**
 * A referral money chain of the probe's own, ending in one persisted accrual.
 *
 * `loadCommissionContext` runs before dispatch and resolves the source for any
 * commissions verb, so with no eligible source every verb -- `accrue`,
 * `clawback` and a verb that does not exist alike -- stops at the same lookup,
 * short of the code that branches on the verb. An accrual that already exists
 * sends `loadCommissionContext` down its `existing` shortcut instead, dispatch
 * is reached, and `mutateCommission` answers all three differently without
 * writing anything.
 *
 * Every row is new and belongs to this run. The seeded referral chain would
 * have been two inserts instead of nine, but a payment and an accrual hung off
 * a shared seeded invoice are visible to every other suite that reads it.
 */
async function seedCommissionSource(): Promise<void> {
  await db.insert(accounts).values({
    id: fixture.commissionPartnerAccountId,
    legalName: `Command catalogue probe ${run} commission partner`,
    relationshipRoles: ["partner"],
    registeredAddress: {},
    billingContact: {},
    apContact: {},
    invoiceDeliveryEmail: `commission-partner-${run}@probe.invalid`,
    domain: `commission-partner-${run}.probe.invalid`,
    country: "US",
    currency: "USD",
    // The accrual's policy is checked against these two by
    // `validate_commission_source_truth`, so they are the source of the
    // 1200/1000 basis points below rather than a coincidence.
    partnerAgreementType: "referral",
    commissionRateBps: 1200,
    commissionHoldbackBps: 1000,
  });
  await db.insert(accounts).values({
    id: fixture.commissionBuyerAccountId,
    legalName: `Command catalogue probe ${run} commission buyer`,
    relationshipRoles: ["direct_client"],
    registeredAddress: {},
    billingContact: {},
    apContact: {},
    invoiceDeliveryEmail: `commission-buyer-${run}@probe.invalid`,
    domain: `commission-buyer-${run}.probe.invalid`,
    country: "US",
    currency: "USD",
  });
  await db.insert(documents).values({
    id: fixture.commissionDocumentId,
    accountId: fixture.commissionBuyerAccountId,
    kind: "agreement",
    storageKey: `catalogue-probe/${run}/agreement.pdf`,
    contentHash: `${run}${randomUUID().replaceAll("-", "")}`
      .padEnd(64, "0")
      .slice(0, 64),
    mimeType: "application/pdf",
    byteLength: 1n,
    objectLockMode: "COMPLIANCE",
    retainUntil: new Date("2099-01-01T00:00:00.000Z"),
    storageVersionId: `catalogue-probe-${run}`,
  });
  await db.insert(agreements).values({
    id: fixture.commissionAgreementId,
    accountId: fixture.commissionBuyerAccountId,
    paper: "ours",
    executionMode: "click_through",
    executedDocumentId: fixture.commissionDocumentId,
    negotiationStatus: "standard",
    effectiveOn: "2026-01-01",
    termMonths: 12,
    renewalType: "auto_renew",
    noticeDays: 60,
    status: "active",
    signerUserId: fixture.userId,
    authorityTitle: "Command catalogue probe",
    authorityAttested: true,
    acceptedIp: "192.0.2.1",
    acceptedUserAgent: "Command catalogue probe",
    textHash: "a".repeat(64),
  });
  await db.insert(quotes).values({
    id: fixture.commissionQuoteId,
    accountId: fixture.commissionBuyerAccountId,
    partnerAccountId: fixture.commissionPartnerAccountId,
    priceBookId: seededPriceBookId,
    seriesId: randomUUID(),
    revision: 1,
    status: "accepted",
    currency: "USD",
    totalMinor: 180_000n,
    marginFloorResult: "pass",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    createdBy: fixture.userId,
  });
  await db.insert(orders).values({
    id: fixture.commissionOrderId,
    quoteId: fixture.commissionQuoteId,
    agreementId: fixture.commissionAgreementId,
    accountId: fixture.commissionBuyerAccountId,
    invoicingAccountId: fixture.commissionBuyerAccountId,
    partnerAccountId: fixture.commissionPartnerAccountId,
    sourcing: "referral",
    signerUserId: fixture.userId,
    authorityTitle: "Command catalogue probe",
    authorityAttested: true,
    status: "accepted",
    serviceStartsOn: "2026-02-01",
    immutableAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  // amount = quote total + amendment delta + tax, which
  // `validate_invoice_payment_projection_truth` re-derives on insert.
  await db.insert(invoices).values({
    id: fixture.commissionInvoiceId,
    orderId: fixture.commissionOrderId,
    accountId: fixture.commissionBuyerAccountId,
    currency: "USD",
    amountMinor: 180_000n,
    taxMinor: 0n,
    amendmentDeltaMinor: 0n,
    taxTreatment: "not_determined",
    status: "draft",
  });
  await db.insert(payments).values({
    id: fixture.commissionPaymentId,
    invoiceId: fixture.commissionInvoiceId,
    orderId: fixture.commissionOrderId,
    stripePaymentIntentId: `pi_catalogue_probe_${run}`,
    currency: "USD",
    amountMinor: 1_000n,
    status: "succeeded",
    receivedAt: commissionPaidAt,
  });
  // Derived exactly the way the database derives it: 1000 collected, 12% of it
  // is 120, 10% of that is held back. A different arithmetic here is refused.
  await db.insert(commissionAccruals).values({
    id: fixture.commissionAccrualId,
    partnerAccountId: fixture.commissionPartnerAccountId,
    invoiceId: fixture.commissionInvoiceId,
    sourceType: "payment",
    sourceId: fixture.commissionPaymentId,
    rateBps: 1200,
    holdbackBps: 1000,
    currency: "USD",
    netCollectedRevenueMinor: 1_000n,
    amountMinor: 120n,
    holdbackMinor: 12n,
    period: commissionPeriod,
    status: "accrued",
  });
}

/**
 * The record each resource is probed against. A resource whose verb branch sits
 * behind a record lookup answers every verb "not found" until one exists, and a
 * probe against nothing would prove nothing.
 *
 * `accounts` is probed against a real, in-scope account because against a
 * missing record every verb is "not found" before any branch, which would say
 * nothing about the code. Against a real record its six verbs reach the shared
 * patch, and the write is rolled back at the audit event.
 */
const subjectByResource: Partial<Record<CoreResourceName, string>> = {
  accounts: fixture.accountId,
  procurement_profiles: fixture.procurementProfileId,
  price_books: fixture.priceBookId,
  quotes: fixture.quoteId,
  deal_registrations: fixture.dealRegistrationId,
};

/**
 * Where optimistic concurrency is checked before the verb branch, the probe has
 * to pass the check or every verb collapses to one version conflict and the
 * resource looks verb-blind when it is not. The fixture rows are freshly
 * inserted and no probe commits, so their version stays the column default.
 */
const expectedVersionByResource: Partial<Record<CoreResourceName, number>> = {
  accounts: 1,
  quotes: 1,
};

/**
 * The smallest payload that reaches the verb branch, where empty does not.
 *
 * `commissions` is the only one: `loadCommissionContext` parses the source out
 * of the payload before dispatch, so an empty payload never gets as far as the
 * code that branches on the verb.
 */
const payloadByResource: Partial<
  Record<CoreResourceName, Record<string, unknown>>
> = {
  commissions: {
    sourceType: "payment",
    sourceId: fixture.commissionPaymentId,
  },
};

/** The account each resource is probed under, where it is not the default. */
const accountByResource: Partial<Record<CoreResourceName, string>> = {
  commissions: fixture.commissionPartnerAccountId,
};

/**
 * Exactly how each resource refuses a verb no branch implements.
 *
 * These are the only answers this file treats as failure. Each is the literal
 * message thrown by the resource's own fallthrough (or, for the two resources
 * the dispatch does not route, by the dispatch default), prefixed with the
 * error code the way `answerTo` renders it. They are compared by equality: a
 * verb answered with anything else reached a branch.
 *
 * `procurement_profiles` is the one entry that takes the verb, because
 * `mutateProcurement`'s fallthrough interpolates it into the message. That is
 * not a problem for equality -- the expected string is built, not stripped --
 * but the message would be better without it, and this entry becomes a
 * constant like the other fourteen the day it is.
 *
 * `reports` refuses an unknown verb and an unauthorised caller with one
 * message, so this string is also what a caller who is not a non-assisted
 * internal operator is told. The probe's authorization satisfies that clause
 * (see `mutation`), so for `reports:create` the message can only mean the verb.
 */
const missingVerbRefusal: Record<
  CoreResourceName,
  ((action: string) => string) | null
> = {
  accounts: null,
  procurement_profiles: (action) =>
    `INVALID_STATE: Procurement profiles do not implement the ${action} command`,
  price_books: () => "INVALID_STATE: Unsupported price book action",
  quotes: () => "INVALID_STATE: Unsupported quote transition",
  orders: () =>
    "INVALID_STATE: Order state changes require provider confirmation or lifecycle offboarding",
  amendments: () =>
    "INVALID_STATE: Amendment acceptance and application use the immutable create command",
  commitments: () => "INVALID_STATE: Unsupported commitment command",
  invoices: () =>
    "INVALID_STATE: Invoice issuance is workflow-owned and provider status advances only from the verified Stripe webhook",
  credit_notes: () => "INVALID_STATE: Unsupported credit-note action",
  refunds: () => "INVALID_STATE: Unsupported refund action",
  disputes: () => "INVALID_STATE: Unsupported dispute action",
  deal_registrations: () =>
    "INVALID_STATE: Unsupported deal registration transition",
  commissions: () =>
    "INVALID_STATE: Statement and settlement run through the commission workflow",
  accounting_exports: () =>
    "INVALID_STATE: accounting_exports commands require their dedicated workflow or provider boundary",
  marketplace_reconciliations: () =>
    "INVALID_STATE: marketplace_reconciliations commands require their dedicated workflow or provider boundary",
  reports: () =>
    "INVALID_STATE: Report exports require a non-assisted internal operator",
};

/**
 * Resources that give no missing-verb refusal, by name, with the reason.
 *
 * For these the behavioural check below is vacuous and says so. Their verbs are
 * still held to `exercisedVerbs`, which is what stops a verb being added to one
 * of them unnoticed.
 */
const resourcesWithNoMissingVerbRefusal: Readonly<
  Partial<Record<CoreResourceName, string>>
> = {
  accounts:
    "mutateAccount branches on create and then stops: every other verb, including one that does not exist, reaches the same shared three-key patch, so the repository has no answer that means 'no such verb'. Per-verb branches in mutateAccount would give it one and would fail this entry on the way in.",
};

/**
 * The advertised verbs this file invokes, written out per resource.
 *
 * Read from the catalogue instead and an invented verb would be invoked, would
 * reach whatever the resource does with an unknown verb, and on `accounts`
 * would pass. Written out, an invented verb is in neither this list nor
 * `unexercisableVerbs` and the partition assertion fails. Every name here is
 * invoked in `beforeAll`.
 */
const exercisedVerbs: Record<CoreResourceName, readonly string[]> = {
  accounts: [
    "create",
    "update",
    "add_role",
    "add_contact",
    "set_payment_terms",
    "set_partner_credit",
  ],
  procurement_profiles: [
    "create",
    "update",
    "add_certificate",
    "record_supplier_document",
  ],
  price_books: [
    "create",
    "add_rate",
    "request_activation",
    "activate",
    "retire",
  ],
  quotes: [
    "create",
    "approve_exception",
    "reject_exception",
    "prepare_artifact",
    "issue",
    "expire",
    "revise",
  ],
  orders: ["prepare_artifact", "create"],
  amendments: ["prepare_artifact", "create"],
  commitments: [
    "create",
    "record_usage",
    "correct_usage",
    "amend_allowance",
    "renew",
    "reconcile",
  ],
  invoices: ["create", "evaluate_dunning"],
  credit_notes: ["issue"],
  refunds: ["submit"],
  disputes: ["create"],
  deal_registrations: ["create", "approve", "reject", "extend", "convert"],
  commissions: ["accrue", "clawback"],
  accounting_exports: [],
  marketplace_reconciliations: [],
  reports: ["create"],
};

/**
 * Advertised verbs no probe here can invoke, named one at a time with a written
 * reason each.
 *
 * Empty, and that is a measurement rather than an aspiration: all forty-five
 * advertised verbs are invoked below. An entry belongs here only when the verb
 * needs external state, a provider or a multi-step setup this file cannot
 * stand up -- never because the verb turned out to be unimplemented, which is
 * the finding, not the excuse.
 */
const unexercisableVerbs: Readonly<
  Partial<Record<CoreResourceName, Readonly<Record<string, string>>>>
> = {};

function mutation(resource: CoreResourceName, action: string) {
  const userId = ids.user.parse(fixture.userId);
  const authorization: AuthorizationContext = {
    userId,
    accountIds: [
      ids.account.parse(fixture.accountId),
      ids.account.parse(fixture.commissionPartnerAccountId),
    ],
    // `finance_approver` is load-bearing and deliberate: it narrows what this
    // actor may append to `audit_events` to the finance aggregates, so the
    // probes that do reach a write -- the `accounts` patch, `approve` and
    // `reject` on a deal registration -- are refused at the audit event and
    // roll back. The probe measures how far execution got, and writes nothing.
    // `internal_operator` is what gets `reports:create` past the operator
    // clause it shares with its missing-verb refusal.
    roles: ["owner", "finance_approver", "internal_operator"],
    isInternalStaff: true,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
  return {
    resource,
    id: subjectByResource[resource] ?? randomUUID(),
    accountId: accountByResource[resource] ?? fixture.accountId,
    action,
    ...(expectedVersionByResource[resource] === undefined
      ? {}
      : { expectedVersion: expectedVersionByResource[resource] }),
    payload: payloadByResource[resource] ?? {},
    actor: { kind: "user" as const, id: userId },
    authorization,
    requestId: `catalogue-probe-${randomUUID()}`,
    idempotencyKey: `catalogue-probe-${randomUUID()}`,
    occurredAt: "2026-08-14T00:00:00.000Z",
  };
}

/** How the repository answered: the code and the message, or "accepted". */
async function answerTo(
  resource: CoreResourceName,
  action: string,
): Promise<string> {
  try {
    await service.mutate(mutation(resource, action));
    return "accepted";
  } catch (error) {
    if (error instanceof CoreServiceError)
      return `${error.code}: ${error.message}`;
    return `${(error as Error).name}: ${(error as Error).message.slice(0, 200)}`;
  }
}

/** The resource's answer to a verb that does not exist, guard bypassed. */
async function answerToAbsentVerb(resource: CoreResourceName): Promise<string> {
  const implemented = databaseCoreCommands[resource] as unknown as string[];
  implemented.push(ABSENT_VERB);
  try {
    return await answerTo(resource, ABSENT_VERB);
  } finally {
    implemented.splice(implemented.indexOf(ABSENT_VERB), 1);
  }
}

/** Measured once, in `beforeAll`. */
const absentAnswers = new Map<CoreResourceName, string>();
const answers = new Map<string, string>();

const answerFor = (resource: CoreResourceName, action: string): string =>
  answers.get(`${resource}:${action}`) ?? "<not invoked>";

describe("every advertised core command reaches a branch", () => {
  beforeAll(async () => {
    await seed();
    for (const resource of coreResourceNames) {
      absentAnswers.set(resource, await answerToAbsentVerb(resource));
      for (const action of exercisedVerbs[resource])
        answers.set(`${resource}:${action}`, await answerTo(resource, action));
    }
  }, 300_000);

  it("classifies every resource as having a missing-verb refusal or not", () => {
    const declared = coreResourceNames.filter(
      (resource) => missingVerbRefusal[resource] !== null,
    );
    const undeclared = Object.keys(resourcesWithNoMissingVerbRefusal);
    for (const resource of undeclared)
      expect(
        missingVerbRefusal[resource as CoreResourceName],
        `${resource} is listed as having no missing-verb refusal but declares one`,
      ).toBeNull();
    expect(
      [...declared, ...undeclared].sort(),
      "resources with and without a missing-verb refusal must partition coreResourceNames",
    ).toEqual([...coreResourceNames].sort());
    for (const [resource, reason] of Object.entries(
      resourcesWithNoMissingVerbRefusal,
    ))
      expect(
        reason.length,
        `${resource} is excused from the behavioural check with no reason`,
      ).toBeGreaterThan(0);
  });

  it("refuses a verb that does not exist, for every resource", () => {
    // If any resource accepted it, this file would have written a row and an
    // audit event under a verb nobody implemented, and every assertion below
    // would be measuring a repository that does not check verbs at all.
    for (const resource of coreResourceNames)
      expect(
        absentAnswers.get(resource),
        `${resource} accepted ${ABSENT_VERB}, a verb that does not exist`,
      ).not.toBe("accepted");
  });

  it("still refuses a missing verb in exactly the declared words", () => {
    // What keeps `missingVerbRefusal` from going stale. Reword a fallthrough in
    // `database-finance.ts` and this fails here, rather than silently turning
    // the check below into a comparison against a string nothing produces.
    for (const resource of coreResourceNames) {
      const declared = missingVerbRefusal[resource];
      if (declared === null) continue;
      expect(
        absentAnswers.get(resource),
        `${resource} no longer refuses a nonexistent verb the way missingVerbRefusal says it does, so that declaration is stale and the binding below is not measuring anything`,
      ).toBe(declared(ABSENT_VERB));
    }
  });

  it("invokes every advertised verb, or names it unexercisable with a reason", () => {
    for (const resource of coreResourceNames) {
      const exempt = unexercisableVerbs[resource] ?? {};
      const accounted = [...exercisedVerbs[resource], ...Object.keys(exempt)];
      expect(
        new Set(accounted).size,
        `${resource} lists a verb twice: ${accounted.join(", ")}`,
      ).toBe(accounted.length);
      expect(
        [...accounted].sort(),
        `${resource}: every advertised verb must be invoked or named unexercisable -- adding one to the catalogue without doing either fails here`,
      ).toEqual([...coreCommandCatalogue[resource]].sort());
      for (const action of exercisedVerbs[resource])
        expect(
          answers.has(`${resource}:${action}`),
          `${resource}:${action} is listed as exercised but was never invoked`,
        ).toBe(true);
      for (const [action, reason] of Object.entries(exempt))
        expect(
          reason.length,
          `${resource}:${action} is named unexercisable with no reason`,
        ).toBeGreaterThan(0);
    }
  });

  it("answers no advertised verb with its resource's missing-verb refusal", () => {
    const unimplemented: string[] = [];
    for (const resource of coreResourceNames) {
      const declared = missingVerbRefusal[resource];
      if (declared === null) continue;
      for (const action of exercisedVerbs[resource]) {
        const answer = answerFor(resource, action);
        if (answer === declared(action))
          unimplemented.push(
            `${resource}:${action} -- answered "${answer}", which is ${resource}'s refusal of a verb no branch implements`,
          );
      }
    }
    expect(unimplemented, unimplemented.join("\n")).toEqual([]);
  });
});
