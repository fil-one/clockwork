import "server-only";

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { MinorUnitSchema, uuidV7 } from "@clockwork/contracts";
import {
  commercialArtifactSourceHash,
  CommercialArtifactDefinitionSchema,
  type CommercialArtifactDefinition,
} from "@clockwork/db/core";
import type { DocumentLineItem } from "@clockwork/documents/model";
import {
  acceptOrder,
  createQuoteDraft,
  issueQuote,
  type AccountCommercialRecord,
  type AcceptedOrder,
  type GoverningAgreement,
  type PricedQuoteLine,
  type QuoteSnapshot,
} from "@clockwork/domain/core";
import { demoPersonas } from "@clockwork/testing/personas";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import {
  annualCapacityLines,
  demoPartyFor,
  demoUuid,
} from "./demo-artifact-catalog";
import type { DemoCreatedOrder } from "./demo-portal-records";
import { configuredDemoStateStore } from "./demo-state-store";
import { ExperienceProblem } from "./model";
import {
  demoProjectionRecordId,
  demoProjectionRecordVersion,
} from "./projection-source";

/**
 * The demo's order acceptance.
 *
 * It is the SAME two passes the authoritative repository runs, and — where the
 * decision belongs to the product rather than to the store — the same code:
 * `acceptOrder`, `createQuoteDraft` and `issueQuote` from
 * `@clockwork/domain/core` decide whether this acceptance is allowed and what
 * the resulting order is. Nothing in this file decides that a quote may be
 * accepted, that an agreement is current, that procurement is ready, or that a
 * service term is coherent. Every one of those refusals comes out of
 * `acceptOrder`, unchanged, and lands in front of the prospect as the product's
 * own refusal.
 *
 * What IS substituted is persistence, and only persistence:
 *
 *   authoritative                            demo
 *   ------------------------------------------------------------------------
 *   quotes + quote_snapshots rows            a seeded quote run through
 *                                            createQuoteDraft + issueQuote
 *   accounts / procurement_profiles rows     a seeded commercial record
 *   agreements row                           a seeded governing agreement
 *   core_commercial_artifact_requests        the demo state store
 *   public.orders + order_lines + profiles   the demo state store
 *
 * The binding between the two passes is the product's binding, not a looser
 * one. `mutateOrder` re-derives the artifact definition from the create
 * command, and `assertCommercialArtifactBinding` refuses unless
 * `(document_id, subject_type, subject_id, document_kind, source_hash)` all
 * match the stored request. `createDemoOrder` re-derives the definition the
 * same way and applies the same five-way match against the stored demo
 * request, so an edited entry after a prepare is refused here exactly as it is
 * there — which is the behaviour the surface's `preparedFor` guard exists for.
 */

/** Seven years, matching `ARTIFACT_RETENTION_YEARS` on the acceptance surface. */
const ARTIFACT_RETENTION_YEARS = 7;

export interface DemoCommercialArtifactRequest {
  readonly id: string;
  readonly documentId: string;
  readonly subjectType: "order";
  readonly subjectId: string;
  readonly commercialAccountId: string;
  readonly audienceAccountId: string;
  readonly audience: "end_client" | "partner";
  readonly documentKind: "order_form";
  readonly sourceHash: string;
  readonly definition: CommercialArtifactDefinition;
  readonly retainUntil: string;
  readonly requestedBy: string;
  readonly createdAt: string;
}

/**
 * The two demo-only collections this file owns. They are optional keys on the
 * existing demo state, exactly as the experience repository's own collections
 * are, so the schema version is unchanged and a store written by an older build
 * still parses. A reset drops them with everything else.
 */
export interface DemoOrderAcceptanceState extends DemoAdapterState {
  readonly commercialArtifactRequests?: Readonly<
    Record<string, DemoCommercialArtifactRequest>
  >;
  readonly createdOrders?: Readonly<Record<string, DemoCreatedOrder>>;
  readonly acceptedQuoteOrders?: Readonly<Record<string, string>>;
  readonly orderCommandReceipts?: Readonly<
    Record<string, DemoOrderCommandReceipt>
  >;
}

/* --------------------------------------------------------------------------
 * The acceptance context
 *
 * `mutateOrder` assembles this from rows. Here it is assembled from the demo
 * fixtures — and then handed to exactly the same domain functions.
 * ----------------------------------------------------------------------- */

/**
 * A demo quote the ceremony can actually be run against.
 *
 * Membership is the demo's scripted boundary, and it is narrow on purpose. An
 * acceptance needs an issued quote with priced lines, a current governing
 * agreement and a procurement profile; the demo states those for the direct
 * buyer's book, which is where every guided journey that reaches acceptance
 * leads. A quote outside this book is refused by name rather than by a generic
 * fault — see `selectQuote`.
 */
export interface DemoAcceptanceQuote {
  /** The projection record key the quotes ledger addresses this row by. */
  readonly recordKey: string;
  readonly displayNumber: string;
  readonly revision: number;
  readonly accountId: string;
  readonly buyerDomain: string;
  readonly locale: "en-US" | "en-GB" | "en-IE" | "es-ES";
  readonly paymentTermsDays: number;
  readonly priceBook: string;
  readonly ownerUserId: string;
  readonly createdAt: string;
  readonly issuedAt: string;
  /** Seeded expiry. Rolled forward once the reader's clock passes it. */
  readonly expiresAt: string;
  readonly agreementId: string;
  readonly agreementVersion: number;
  readonly agreementEffectiveOn: string;
  /** The priced lines, taken from the very document lines the demo prints. */
  readonly lineItems: readonly DocumentLineItem[];
}

const directBuyer = demoPersonas.directBuyer;

function directQuoteEntry(
  recordKey: string,
  displayNumber: string,
  revision: number,
): DemoAcceptanceQuote {
  return {
    recordKey,
    displayNumber,
    revision,
    accountId: directBuyer.selectedAccountId,
    buyerDomain: "meridian-archive.test",
    locale: "en-US",
    paymentTermsDays: 30,
    priceBook: "USD-2026.2",
    ownerUserId: directBuyer.userId,
    createdAt: "2026-07-20T15:00:00.000Z",
    issuedAt: "2026-07-29T15:22:00.000Z",
    expiresAt: "2026-08-28T23:59:59.000Z",
    agreementId: demoUuid("agreement:AGR-2026-0042"),
    agreementVersion: 3,
    agreementEffectiveOn: "2025-10-01",
    lineItems: annualCapacityLines,
  };
}

/**
 * The direct buyer's two open quotes: the one the quotes ledger opens on, and
 * the renewal the guided journey deep-links to. Both are the same committed
 * capacity offer, which is why they share the priced lines the catalogue's
 * documents already print.
 */
export const demoAcceptanceQuoteBook: readonly DemoAcceptanceQuote[] = [
  directQuoteEntry("Q-2026-0184-v3", "Q-2026-0184", 3),
  directQuoteEntry("quote-direct-renewal-v2", "Q-2026-0312", 2),
];

function domainMoney(value: {
  currency: string;
  minorUnits: string;
}): PricedQuoteLine["unitPrice"] {
  if (
    value.currency !== "USD" &&
    value.currency !== "EUR" &&
    value.currency !== "GBP"
  )
    throw new Error(`DEMO_QUOTE_CURRENCY_UNSUPPORTED:${value.currency}`);
  // `Money.minor` is branded, and the brand is the contract's own validation:
  // parsing rather than asserting is what keeps a malformed fixture from
  // reaching the domain as a well-typed lie.
  return {
    currency: value.currency,
    minor: MinorUnitSchema.parse(value.minorUnits),
  };
}

/**
 * One priced quote line, from the very line item the demo's documents print.
 *
 * The money is read off the document line rather than restated. A demo whose
 * quote card said `$184,800.00` and whose order form said something else would
 * be a worse failure than no order form at all, and there is only one way to
 * guarantee they agree: one source.
 */
function pricedLine(item: DocumentLineItem, index: number): PricedQuoteLine {
  const unitPrice = domainMoney(item.unitPrice ?? item.amount);
  return {
    id: demoUuid(`quote-line:${item.id}`),
    rateCardId: demoUuid(`rate-card:${item.id}`),
    sku: item.description,
    region: "us-east-1",
    unit: item.unitLabel ?? "unit",
    approvedClaim: "demo-fixture",
    quantity: item.quantity ?? "1",
    termMonths: 12,
    unitPrice,
    listUnitPrice: unitPrice,
    overageRate: domainMoney({
      currency: item.amount.currency,
      minorUnits: "0",
    }),
    lineTotal: domainMoney(item.amount),
    discountBps: 0,
    commitType: index === 0 ? "term_drawdown" : "period_allowance",
    stripeTaxCode: "txcd_10000000",
    qboIncomeAccount: "4000-subscription",
    marginResult: "pass",
  };
}

function quoteTotal(
  lines: readonly PricedQuoteLine[],
): PricedQuoteLine["lineTotal"] {
  const first = lines[0];
  if (!first) throw new Error("DEMO_QUOTE_HAS_NO_LINES");
  return domainMoney({
    currency: first.lineTotal.currency,
    minorUnits: lines
      .reduce((total, line) => total + BigInt(line.lineTotal.minor), 0n)
      .toString(),
  });
}

/**
 * How long a demo quote stays acceptable.
 *
 * `acceptOrder` refuses an acceptance at or after the quote's expiry, and that
 * refusal is the product's — it is not relaxed here. What IS demo-specific is
 * the expiry itself: a fixture date rots, and a prospect opening this demo six
 * months after the seed was written would meet a dead end that says nothing
 * about the product. So the seeded expiry stands while it is still ahead of the
 * reader's clock, and rolls forward once it is behind. The rule still runs; only
 * the fixture is kept alive.
 */
const DEMO_QUOTE_HORIZON_DAYS = 14;

function demoQuoteExpiry(seeded: string, now: Date): string {
  const seededAt = Date.parse(seeded);
  if (Number.isFinite(seededAt) && seededAt > now.getTime()) return seeded;
  return new Date(
    now.getTime() + DEMO_QUOTE_HORIZON_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

/**
 * The issued quote the acceptance is taken against.
 *
 * Built by the domain's own `createQuoteDraft` and `issueQuote` rather than
 * written out as a literal, which is what makes `assertQuoteSnapshotUnchanged`
 * meaningful inside `acceptOrder`: the immutable snapshot is the one the
 * issuance produced, so the tamper check is a real check rather than a field
 * copied to satisfy it.
 */
function demoQuoteSnapshot(
  quote: DemoAcceptanceQuote,
  now: Date,
): QuoteSnapshot {
  const lines = quote.lineItems.map(pricedLine);
  const draft = createQuoteDraft({
    id: demoQuoteId(quote),
    seriesId: demoUuid(`quote-series:${quote.recordKey}`),
    revision: quote.revision,
    accountId: quote.accountId,
    priceBook: { id: demoUuid(`price-book:${quote.priceBook}`), version: 1 },
    route: "direct",
    lines,
    total: quoteTotal(lines),
    marginResult: "pass",
    exceptionReasons: [],
    expiresAt: demoQuoteExpiry(quote.expiresAt, now),
    createdBy: quote.ownerUserId,
    createdAt: quote.createdAt,
  });
  return issueQuote(draft, {
    issuedAt: quote.issuedAt,
    renderedDocumentId: demoUuid(`quote-document:${quote.recordKey}`),
  });
}

/**
 * The buyer, in the shape `procurementReadiness` and `acceptOrder` read.
 *
 * `poRequired` is deliberately true. The acceptance surface already makes the
 * purchase order a required field, so the demo account whose acceptance it
 * drives is the kind of account that requires one — and `procurementReadiness`
 * is the thing that says so, rather than the form saying it alone.
 */
function demoBuyer(quote: DemoAcceptanceQuote): AccountCommercialRecord {
  const party = demoPartyFor(quote.accountId);
  const email = party.contactEmail ?? `ap@${quote.buyerDomain}`;
  return {
    id: quote.accountId,
    legalName: party.legalName,
    country: party.address.countryCode,
    domain: quote.buyerDomain,
    roles: ["direct_client"],
    taxIds: party.taxId
      ? [
          {
            jurisdiction: party.address.countryCode,
            type: party.address.countryCode === "US" ? "ein" : "vat",
            value: party.taxId,
            validation: "valid",
          },
        ]
      : [],
    contacts: [
      {
        name: party.contactName ?? party.legalName,
        email,
        roles: ["billing", "accounts_payable"],
      },
    ],
    currency: quote.lineItems[0]?.amount.currency ?? "USD",
    paymentTerms: {
      kind: "net",
      days: quote.paymentTermsDays,
      creditApproved: true,
    },
    procurement: {
      poRequired: true,
      apContactEmail: email,
      invoiceDeliveryEmail: email,
      supplierPortalStatus: "not_required",
      certificates: [],
      furnishedDocuments: [],
    },
    rowVersion: 1,
  };
}

function demoGoverningAgreement(
  quote: DemoAcceptanceQuote,
): GoverningAgreement {
  return {
    id: quote.agreementId,
    accountId: quote.accountId,
    version: quote.agreementVersion,
    status: "active",
    effectiveOn: quote.agreementEffectiveOn,
  };
}

/* --------------------------------------------------------------------------
 * The order form definition
 * ----------------------------------------------------------------------- */

function definitionMoney(value: { currency: string; minor: string }) {
  return domainMoney({ currency: value.currency, minorUnits: value.minor });
}

function artifactMoney(value: { currency: string; minor: string }) {
  const money = definitionMoney(value);
  return { currency: money.currency, minorUnits: money.minor };
}

/**
 * The order form the two passes are bound to.
 *
 * This mirrors `orderArtifactDefinition` field for field. It is restated rather
 * than called because that function takes a `RuntimeTransaction` and reads the
 * recipient party, the presentation policy and the signer's name from rows, and
 * it lives under `packages/db/src/repositories/core`, which is not exported and
 * is outside this lane. The restatement is held to the original two ways:
 *
 *  1. `CommercialArtifactDefinitionSchema` — the authoritative schema, parsed
 *     here, so a field the product's order form requires and this one omits is
 *     a parse failure rather than a quiet difference; and
 *  2. `commercialArtifactSourceHash` — the authoritative hash, so the demo's
 *     prepare/create binding is computed by the same function the product's is.
 */
function demoOrderArtifactDefinition(input: {
  order: AcceptedOrder;
  quote: DemoAcceptanceQuote;
  issuedAt: string;
  signerName: string;
}): { definition: CommercialArtifactDefinition; sourceHash: string } {
  const { order } = input;
  if (!order.serviceEndsOn)
    throw new Error("COMMERCIAL_ARTIFACT_ORDER_TERM_REQUIRED");
  const recipient = demoPartyFor(order.invoicingAccountId);
  const total = artifactMoney({
    currency: order.lines[0]?.lineTotal.currency ?? "USD",
    minor: order.lines
      .reduce((sum, line) => sum + BigInt(line.lineTotal.minor), 0n)
      .toString(),
  });
  const definition = CommercialArtifactDefinitionSchema.parse({
    kind: "order_form",
    displayDocumentId: `ORD-${order.id}`,
    documentVersion: "1",
    issuedAt: input.issuedAt,
    locale: input.quote.locale,
    recipient,
    issuerMode: "platform",
    orderNumber: `ORD-${order.id}`,
    quoteReference: `Q-${order.quoteId}-R${order.quoteRevision}`,
    governingAgreementReference: `${order.agreementId}-v${order.agreementVersion}`,
    ...(order.poNumber ? { purchaseOrderNumber: order.poNumber } : {}),
    servicePeriod: {
      startDate: order.serviceStartsOn,
      endDate: order.serviceEndsOn,
    },
    currency: total.currency,
    lineItems: order.lines.map((line) => ({
      id: line.id,
      description: line.sku,
      detail: `${line.region}; ${line.termMonths} month term`,
      quantity: line.quantity,
      unitPrice: artifactMoney(line.unitPrice),
      amount: artifactMoney(line.lineTotal),
    })),
    totals: { subtotal: total, total },
    paymentTerms: `Net ${input.quote.paymentTermsDays} days`,
    signer: {
      name: input.signerName,
      title: order.authorityTitle,
      acceptedAt: order.acceptedAt,
      authorityAttestation: `I am authorized to bind ${recipient.legalName} to this order form.`,
    },
  });
  return { definition, sourceHash: commercialArtifactSourceHash(definition) };
}

/* --------------------------------------------------------------------------
 * The two passes
 * ----------------------------------------------------------------------- */

export interface DemoOrderCommand {
  readonly orderId: string;
  readonly accountId: string;
  readonly quoteId: string;
  readonly signerUserId: string;
  readonly authorityTitle: string;
  readonly authorityAttested: boolean;
  readonly poNumber?: string;
  readonly serviceStartsOn: string;
  readonly serviceEndsOn?: string;
  readonly coTerminateOn?: string;
  readonly noticeOn?: string;
  readonly acceptedAt: string;
  readonly orderLineIds: readonly string[];
  readonly retainUntil?: string;
  readonly orderFormDocumentId?: string;
}

export interface DemoOrderCommandResult {
  readonly status: "artifact_requested" | "accepted";
  readonly rowVersion: 1;
  readonly data: Readonly<Record<string, string>>;
  readonly auditEventId: string;
  readonly outboxEventId: string;
}

interface DemoOrderCommandReceipt {
  readonly userId: string;
  readonly requestHash: string;
  readonly result: DemoOrderCommandResult;
  readonly createdAt: string;
}

export interface DemoOrderCommandExecution {
  readonly result: DemoOrderCommandResult;
  readonly replayed: boolean;
}

function signerNameFor(session: SessionClaims): string {
  const persona = Object.values(demoPersonas).find(
    (candidate) => candidate.userId === session.userId,
  );
  if (!persona)
    throw new ExperienceProblem(
      403,
      "DEMO_SIGNER_UNKNOWN",
      "The demo signer is not one of the catalogue personas",
    );
  return persona.displayName;
}

/**
 * A refusal the product would also make, restated as a problem document.
 *
 * `acceptOrder` throws plain `Error`s carrying the reason. The authoritative
 * service turns those into `INVALID_STATE`; this does the same, and keeps the
 * domain's own sentence, so the prospect reads the product's reason rather than
 * a demo paraphrase of it.
 */
function domainRefusal(error: unknown): never {
  throw new ExperienceProblem(
    422,
    "INVALID_STATE",
    error instanceof Error ? error.message : "The order could not be accepted",
  );
}

/**
 * The identifier the acceptance surface sends as `quoteId`.
 *
 * It is the quote row's `aggregateId`, which the demo projection source assigns
 * positionally, so it is resolved from there rather than restated. A book entry
 * naming a record the projection does not serve is a fixture error and says so.
 */
function demoQuoteId(quote: DemoAcceptanceQuote): string {
  const id = demoProjectionRecordId("customer", "quotes", quote.recordKey);
  if (!id)
    throw new Error(`DEMO_ACCEPTANCE_QUOTE_NOT_PROJECTED:${quote.recordKey}`);
  return id;
}

function selectQuote(command: DemoOrderCommand): DemoAcceptanceQuote {
  const quote = demoAcceptanceQuoteBook.find(
    (candidate) => demoQuoteId(candidate) === command.quoteId,
  );
  if (!quote)
    throw new ExperienceProblem(
      404,
      "DEMO_QUOTE_NOT_ACCEPTABLE",
      "This demo quote cannot be accepted. Only an issued quote can be, and the demo issues the open ones — open the renewal from the quotes ledger to walk the acceptance.",
    );
  if (quote.accountId !== command.accountId)
    throw new ExperienceProblem(
      403,
      "DEMO_QUOTE_ACCOUNT_MISMATCH",
      "The quote belongs to another account",
    );
  return quote;
}

/**
 * Both passes build the same order and the same order form from the same
 * command. The only difference is the document identifier the order carries,
 * which is the sentinel on the prepare pass — exactly as `mutateOrder` does it.
 */
function derive(
  session: SessionClaims,
  command: DemoOrderCommand,
  orderFormDocumentId: string,
  now: Date,
): {
  quote: DemoAcceptanceQuote;
  order: AcceptedOrder;
  definition: CommercialArtifactDefinition;
  sourceHash: string;
} {
  const quote = selectQuote(command);
  if (command.signerUserId !== session.userId)
    throw new ExperienceProblem(
      422,
      "INVALID_STATE",
      "Order signer must be the authenticated acting user",
    );
  const snapshot = demoQuoteSnapshot(quote, now);
  let order: AcceptedOrder;
  try {
    order = acceptOrder({
      orderId: command.orderId,
      quote: snapshot,
      agreement: demoGoverningAgreement(quote),
      buyer: demoBuyer(quote),
      signerUserId: command.signerUserId,
      authorityTitle: command.authorityTitle,
      authorityAttested: command.authorityAttested,
      ...(command.poNumber ? { poNumber: command.poNumber } : {}),
      serviceStartsOn: command.serviceStartsOn,
      ...(command.serviceEndsOn
        ? { serviceEndsOn: command.serviceEndsOn }
        : {}),
      ...(command.coTerminateOn
        ? { coTerminateOn: command.coTerminateOn }
        : {}),
      ...(command.noticeOn ? { noticeOn: command.noticeOn } : {}),
      acceptedAt: command.acceptedAt,
      orderFormDocumentId,
      // One order-line identifier per quote line. `acceptOrder` refuses any
      // other count, and the surface mints one, so a multi-line demo quote
      // would be refused for a reason the reader cannot act on. The extras are
      // derived rather than demanded of the client.
      orderLineIds: snapshot.lines.map(
        (line, index) =>
          command.orderLineIds[index] ??
          demoUuid(`order-line:${command.orderId}:${line.id}`),
      ),
    });
  } catch (error) {
    domainRefusal(error);
  }
  const { definition, sourceHash } = demoOrderArtifactDefinition({
    order,
    quote,
    issuedAt: command.acceptedAt,
    signerName: signerNameFor(session),
  });
  return { quote, order, definition, sourceHash };
}

const PREPARE_SENTINEL_DOCUMENT_ID = "00000000-0000-4000-8000-000000000000";

function prepareInState(
  state: DemoOrderAcceptanceState,
  session: SessionClaims,
  command: DemoOrderCommand,
  now: Date,
): {
  readonly state: DemoOrderAcceptanceState;
  readonly record: DemoCommercialArtifactRequest;
  readonly changed: boolean;
} {
  const retainUntil =
    command.retainUntil ?? defaultRetainUntil(command.acceptedAt);
  if (Date.parse(retainUntil) <= Date.parse(command.acceptedAt))
    throw new ExperienceProblem(
      422,
      "INVALID_STATE",
      "Commercial artifact retention must follow acceptance",
    );
  const { order, definition, sourceHash } = derive(
    session,
    command,
    PREPARE_SENTINEL_DOCUMENT_ID,
    now,
  );
  const id = demoUuid(
    `artifact-request:order:${order.id}:order_form:${sourceHash}`,
  );
  const existing = state.commercialArtifactRequests?.[id];
  if (existing) return { state, record: existing, changed: false };
  const record: DemoCommercialArtifactRequest = {
    id,
    documentId: demoUuid(`order-form-document:${id}`),
    subjectType: "order",
    subjectId: order.id,
    commercialAccountId: order.accountId,
    audienceAccountId: order.invoicingAccountId,
    audience: "end_client",
    documentKind: "order_form",
    sourceHash,
    definition,
    retainUntil,
    requestedBy: session.userId,
    createdAt: now.toISOString(),
  };
  return {
    state: {
      ...state,
      commercialArtifactRequests: {
        ...state.commercialArtifactRequests,
        [id]: record,
      },
    },
    record,
    changed: true,
  };
}

function acceptedOrderIdForQuote(
  state: DemoOrderAcceptanceState,
  quoteId: string,
  quoteRecordKey: string,
): string | undefined {
  return (
    state.acceptedQuoteOrders?.[quoteId] ??
    Object.values(state.createdOrders ?? {}).find(
      (candidate) => candidate.quoteRecordKey === quoteRecordKey,
    )?.id
  );
}

function sameCreatedOrder(
  left: DemoCreatedOrder,
  right: DemoCreatedOrder,
): boolean {
  const { immutableAt: leftImmutableAt, ...leftComparable } = left;
  const { immutableAt: rightImmutableAt, ...rightComparable } = right;
  void leftImmutableAt;
  void rightImmutableAt;
  return JSON.stringify(leftComparable) === JSON.stringify(rightComparable);
}

function createInState(
  state: DemoOrderAcceptanceState,
  session: SessionClaims,
  command: DemoOrderCommand,
  now: Date,
): {
  readonly state: DemoOrderAcceptanceState;
  readonly order: DemoCreatedOrder;
  readonly changed: boolean;
} {
  const documentId = command.orderFormDocumentId;
  if (!documentId)
    throw new ExperienceProblem(
      422,
      "INVALID_STATE",
      "The order form document is required to create an order",
    );
  const { quote, order, sourceHash } = derive(
    session,
    command,
    documentId,
    now,
  );
  const request = Object.values(state.commercialArtifactRequests ?? {}).find(
    (candidate) =>
      candidate.documentId === documentId &&
      candidate.subjectType === "order" &&
      candidate.subjectId === order.id &&
      candidate.documentKind === "order_form" &&
      candidate.sourceHash === sourceHash,
  );
  if (!request)
    throw new ExperienceProblem(
      409,
      "COMMERCIAL_ARTIFACT_BINDING_INVALID",
      "The order form was not prepared for this order and these entries. Prepare it again before accepting.",
    );

  const quoteId = demoQuoteId(quote);
  const acceptedOrderId = acceptedOrderIdForQuote(
    state,
    quoteId,
    quote.recordKey,
  );
  if (acceptedOrderId && acceptedOrderId !== order.id)
    throw new ExperienceProblem(
      409,
      "DEMO_QUOTE_ALREADY_ACCEPTED",
      "This quote has already been accepted into an order",
    );

  const total = order.lines.reduce(
    (sum, line) => sum + BigInt(line.lineTotal.minor),
    0n,
  );
  const created: DemoCreatedOrder = {
    id: order.id,
    quoteRecordKey: quote.recordKey,
    accountId: order.accountId,
    audienceAccountId: order.invoicingAccountId,
    orderFormDocumentId: documentId,
    artifactRequestId: request.id,
    poNumber: order.poNumber ?? "Not recorded",
    authorityTitle: order.authorityTitle,
    signerName: signerNameFor(session),
    serviceStartsOn: order.serviceStartsOn,
    serviceEndsOn: order.serviceEndsOn ?? order.serviceStartsOn,
    acceptedAt: order.acceptedAt,
    // A server fact, keyed on this call's own instant — never on the
    // documentary `acceptedAt` the client stated.
    immutableAt: now.toISOString(),
    currency: order.lines[0]?.lineTotal.currency ?? "USD",
    totalMinor: total.toString(),
    agreementReference: `${order.agreementId}-v${order.agreementVersion}`,
    quoteReference: quote.displayNumber,
  };
  const existing = state.createdOrders?.[order.id];
  if (existing && !sameCreatedOrder(existing, created))
    throw new ExperienceProblem(
      409,
      "DEMO_ORDER_ID_CONFLICT",
      "This order identifier is already bound to different acceptance entries",
    );
  const stored = existing ?? created;
  const indexIsCurrent = state.acceptedQuoteOrders?.[quoteId] === stored.id;
  const currentOverride = state.projectionOverrides[quoteId];
  const projectionIsAccepted =
    currentOverride?.data.status === "accepted" &&
    Array.isArray(currentOverride.data.allowedActions) &&
    currentOverride.data.allowedActions.length === 0;
  if (existing && indexIsCurrent && projectionIsAccepted)
    return { state, order: existing, changed: false };
  const seededVersion = demoProjectionRecordVersion(
    "customer",
    "quotes",
    quote.recordKey,
  );
  if (seededVersion === undefined)
    throw new Error(`DEMO_ACCEPTANCE_QUOTE_NOT_PROJECTED:${quote.recordKey}`);
  return {
    state: {
      ...state,
      createdOrders: { ...state.createdOrders, [stored.id]: stored },
      acceptedQuoteOrders: {
        ...state.acceptedQuoteOrders,
        [quoteId]: stored.id,
      },
      projectionOverrides: {
        ...state.projectionOverrides,
        [quoteId]: {
          version: (currentOverride?.version ?? seededVersion) + 1,
          updatedAt: now.toISOString(),
          data: {
            ...(currentOverride?.data ?? {}),
            status: "accepted",
            statusLabel: "Accepted · order created",
            tone: "success",
            nextAction: `Track order ${stored.id}`,
            allowedActions: [],
          },
        },
      },
    },
    order: stored,
    changed: true,
  };
}

function receiptKey(userId: string, idempotencyKey: string): string {
  return createHash("sha256")
    .update(userId)
    .update("\0/v1/core/commands/orders\0")
    .update(idempotencyKey)
    .digest("hex");
}

function assertIdempotencyInput(
  idempotencyKey: string,
  requestHash: string,
): void {
  if (idempotencyKey.length < 16 || idempotencyKey.length > 255)
    throw new ExperienceProblem(
      422,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid idempotency-key header is required",
    );
  if (!/^[0-9a-f]{64}$/u.test(requestHash))
    throw new Error("DEMO_ORDER_REQUEST_HASH_INVALID");
}

export class DemoOrderAcceptance {
  readonly #store: DemoAdapterStateStore;

  public constructor(
    store: DemoAdapterStateStore = configuredDemoStateStore(),
  ) {
    this.#store = store;
  }

  async #read(): Promise<DemoOrderAcceptanceState> {
    return await this.#store.read();
  }

  /**
   * Pass one. Renders nothing here and creates no order: it records the
   * artifact request the create pass has to match, which is precisely what
   * `persistCommercialArtifactRequest` records on the authoritative path.
   *
   * The request is stored as already `stored` with its document identifier
   * minted, because the demo renders on read — the same property
   * `DemoExperienceRepository.findArtifact` relies on, and for the same reason:
   * the demo's immutable store is process-local, so a serverless instance that
   * did not serve the render must still be able to serve the download.
   */
  public async prepare(
    session: SessionClaims,
    command: DemoOrderCommand,
    now = new Date(),
  ): Promise<DemoCommercialArtifactRequest> {
    let preparedId: string | undefined;
    const committed = (await this.#store.update((current) => {
      const state = current as DemoOrderAcceptanceState;
      const transition = prepareInState(state, session, command, now);
      preparedId = transition.record.id;
      if (!transition.changed) return state;
      return {
        ...transition.state,
        revision: state.revision + 1,
      } satisfies DemoOrderAcceptanceState;
    })) as DemoOrderAcceptanceState;
    const prepared = preparedId
      ? committed.commercialArtifactRequests?.[preparedId]
      : undefined;
    if (!prepared) throw new Error("DEMO_ORDER_PREPARE_COMMIT_MISSING");
    return prepared;
  }

  /**
   * Pass two. Re-derives the order and the order form from the command it is
   * given and refuses unless the stored request matches on all five values
   * `assertCommercialArtifactBinding` matches on. The document the client
   * quotes is never trusted to describe itself.
   */
  public async create(
    session: SessionClaims,
    command: DemoOrderCommand,
    now = new Date(),
  ): Promise<DemoCreatedOrder> {
    let orderId: string | undefined;
    const committed = (await this.#store.update((current) => {
      const value = current as DemoOrderAcceptanceState;
      const transition = createInState(value, session, command, now);
      orderId = transition.order.id;
      if (!transition.changed) return value;
      return {
        ...transition.state,
        revision: value.revision + 1,
      } satisfies DemoOrderAcceptanceState;
    })) as DemoOrderAcceptanceState;
    const created = orderId ? committed.createdOrders?.[orderId] : undefined;
    if (!created) throw new Error("DEMO_ORDER_CREATE_COMMIT_MISSING");
    return created;
  }

  /**
   * The HTTP command path's durable idempotency boundary. The domain mutation
   * and its completed receipt are committed in one store update; there is no
   * claim/complete gap in which a serverless process can lose the response
   * after creating an order. The receipt is scoped to the acting user and this
   * command route, and binds the key to the exact request-byte hash.
   */
  public async execute(input: {
    readonly session: SessionClaims;
    readonly action: "prepare_artifact" | "create";
    readonly command: DemoOrderCommand;
    readonly idempotencyKey: string;
    readonly requestHash: string;
    readonly now?: Date;
  }): Promise<DemoOrderCommandExecution> {
    assertIdempotencyInput(input.idempotencyKey, input.requestHash);
    const key = receiptKey(input.session.userId, input.idempotencyKey);
    const now = input.now ?? new Date();
    const candidateAuditEventId = uuidV7();
    const candidateOutboxEventId = uuidV7();
    const committed = (await this.#store.update((current) => {
      const state = current as DemoOrderAcceptanceState;
      const existing = state.orderCommandReceipts?.[key];
      if (existing) {
        if (
          existing.userId !== input.session.userId ||
          existing.requestHash !== input.requestHash
        )
          throw new ExperienceProblem(
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "The idempotency key was already used for a different request",
          );
        return state;
      }

      let nextState: DemoOrderAcceptanceState;
      let result: DemoOrderCommandResult;
      if (input.action === "prepare_artifact") {
        const transition = prepareInState(
          state,
          input.session,
          input.command,
          now,
        );
        nextState = transition.state;
        result = {
          status: "artifact_requested",
          rowVersion: 1,
          data: {
            orderFormDocumentId: transition.record.documentId,
            artifactRequestId: transition.record.id,
            sourceHash: transition.record.sourceHash,
            retainUntil: transition.record.retainUntil,
          },
          auditEventId: candidateAuditEventId,
          outboxEventId: candidateOutboxEventId,
        };
      } else {
        const transition = createInState(
          state,
          input.session,
          input.command,
          now,
        );
        nextState = transition.state;
        result = {
          status: "accepted",
          rowVersion: 1,
          data: {
            quoteId: input.command.quoteId,
            orderFormDocumentId: transition.order.orderFormDocumentId,
            serviceStartsOn: transition.order.serviceStartsOn,
            serviceEndsOn: transition.order.serviceEndsOn,
            acceptedAt: transition.order.acceptedAt,
            immutableAt: transition.order.immutableAt,
          },
          auditEventId: candidateAuditEventId,
          outboxEventId: candidateOutboxEventId,
        };
      }
      const receipt: DemoOrderCommandReceipt = {
        userId: input.session.userId,
        requestHash: input.requestHash,
        result,
        createdAt: now.toISOString(),
      };
      return {
        ...nextState,
        revision: state.revision + 1,
        orderCommandReceipts: {
          ...state.orderCommandReceipts,
          [key]: receipt,
        },
      } satisfies DemoOrderAcceptanceState;
    })) as DemoOrderAcceptanceState;
    const receipt = committed.orderCommandReceipts?.[key];
    if (!receipt) throw new Error("DEMO_ORDER_COMMAND_RECEIPT_MISSING");
    return {
      result: receipt.result,
      replayed: receipt.result.auditEventId !== candidateAuditEventId,
    };
  }

  /**
   * The demo's `findPreparedOrderForm`. Same question, same answer shape, same
   * single success condition: a stored request for this order, carrying a
   * document.
   */
  public async preparedOrderForm(orderId: string): Promise<{
    documentId: string;
    orderId: string;
    artifactId: string;
  } | null> {
    const request = Object.values(
      (await this.#read()).commercialArtifactRequests ?? {},
    ).find(
      (candidate) =>
        candidate.subjectType === "order" &&
        candidate.subjectId === orderId &&
        candidate.documentKind === "order_form",
    );
    return request
      ? {
          documentId: request.documentId,
          orderId: request.subjectId,
          artifactId: request.id,
        }
      : null;
  }

  /** Every artifact request the demo has prepared, for the download path. */
  public async artifactRequests(): Promise<
    readonly DemoCommercialArtifactRequest[]
  > {
    return Object.values((await this.#read()).commercialArtifactRequests ?? {});
  }

  public async createdOrders(): Promise<readonly DemoCreatedOrder[]> {
    return Object.values((await this.#read()).createdOrders ?? {});
  }
}

function defaultRetainUntil(acceptedAt: string): string {
  const retention = new Date(acceptedAt);
  retention.setUTCFullYear(
    retention.getUTCFullYear() + ARTIFACT_RETENTION_YEARS,
  );
  return retention.toISOString();
}

let acceptance: DemoOrderAcceptance | undefined;

/**
 * One instance per process, sharing the single configured store with the
 * projection source and the experience repository. Separate instances would
 * each hold their own memory store and a prepared form would vanish between the
 * two passes.
 */
export function demoOrderAcceptance(): DemoOrderAcceptance {
  acceptance ??= new DemoOrderAcceptance();
  return acceptance;
}
