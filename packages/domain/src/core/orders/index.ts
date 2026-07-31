import type { Money, ProvisioningPort } from "@clockwork/contracts";

import type { AccountCommercialRecord } from "../accounts";
import { procurementReadiness } from "../accounts";
import type { PricedQuoteLine } from "../pricing";
import type { QuoteSnapshot } from "../quotes";
import { assertQuoteSnapshotUnchanged } from "../quotes";

export interface GoverningAgreement {
  id: string;
  accountId: string;
  version: number;
  status: "active" | "in_notice" | "expired" | "terminated";
  effectiveOn: string;
  endsOn?: string;
  partnerAgreementType?: "referral" | "resale" | "msp" | "embedded";
}

export interface OrderLineSnapshot {
  id: string;
  quoteLineId: string;
  sku: string;
  region: string;
  quantity: string;
  termMonths: number;
  unitPrice: Money;
  overageRate: Money;
  lineTotal: Money;
  commitType: "period_allowance" | "term_drawdown";
  stripeTaxCode: string;
  qboIncomeAccount: string;
  supersededByAmendmentId?: string;
}

export interface AcceptedOrder {
  id: string;
  quoteId: string;
  quoteRevision: number;
  agreementId: string;
  agreementVersion: number;
  accountId: string;
  invoicingAccountId: string;
  partnerAccountId?: string;
  merchantOfRecord: "fil_one" | "partner" | "marketplace";
  sourcing: "direct" | "referral" | "resale" | "distributor" | "marketplace";
  poNumber?: string;
  poDocumentId?: string;
  signerUserId: string;
  authorityTitle: string;
  authorityAttested: true;
  status:
    | "accepted"
    | "provisioning"
    | "active"
    | "amended"
    | "completed"
    | "cancelled"
    | "terminated";
  serviceStartsOn: string;
  serviceEndsOn?: string;
  noticeOn?: string;
  lines: readonly OrderLineSnapshot[];
  acceptedAt: string;
  orderFormDocumentId: string;
  provisioningKey: string;
}

function toOrderLine(line: PricedQuoteLine, id: string): OrderLineSnapshot {
  return {
    id,
    quoteLineId: line.id,
    sku: line.sku,
    region: line.region,
    quantity: line.quantity,
    termMonths: line.termMonths,
    unitPrice: line.unitPrice,
    overageRate: line.overageRate,
    lineTotal: line.lineTotal,
    commitType: line.commitType,
    stripeTaxCode: line.stripeTaxCode,
    qboIncomeAccount: line.qboIncomeAccount,
  };
}

export interface AcceptOrderInput {
  orderId: string;
  quote: QuoteSnapshot;
  agreement: GoverningAgreement;
  partnerAgreement?: GoverningAgreement;
  buyer: AccountCommercialRecord;
  partner?: AccountCommercialRecord;
  signerUserId: string;
  authorityTitle: string;
  authorityAttested: boolean;
  poNumber?: string;
  poDocumentId?: string;
  serviceStartsOn: string;
  serviceEndsOn?: string;
  coTerminateOn?: string;
  noticeOn?: string;
  acceptedAt: string;
  orderFormDocumentId: string;
  orderLineIds: readonly string[];
}

export function acceptOrder(input: AcceptOrderInput): AcceptedOrder {
  const { quote } = input;
  if (quote.status !== "issued")
    throw new Error("Only an issued quote can be accepted");
  assertQuoteSnapshotUnchanged(quote);
  if (Date.parse(input.acceptedAt) >= Date.parse(quote.expiresAt))
    throw new Error("Quote expired before acceptance");
  if (!input.authorityAttested || !input.authorityTitle.trim())
    throw new Error("Binding authority title and attestation are required");
  if (quote.accountId !== input.buyer.id)
    throw new Error("Quote and buyer account differ");
  const readiness = procurementReadiness(input.buyer, input.poNumber);
  if (!readiness.ready)
    throw new Error(
      `Procurement profile incomplete: ${readiness.missing.join(", ")}`,
    );
  if (input.poDocumentId && !input.poNumber)
    throw new Error("PO document requires a PO number");
  if (
    input.orderLineIds.length !== quote.lines.length ||
    new Set(input.orderLineIds).size !== input.orderLineIds.length
  )
    throw new Error(
      "Every quote line requires one unique order-line identifier",
    );
  const partnerRoute =
    quote.route === "referral" ||
    quote.route === "resale" ||
    quote.route === "distributor";
  if (
    partnerRoute &&
    (!input.partner || quote.partnerAccountId !== input.partner.id)
  )
    throw new Error("Partner order must bind the quote partner account");
  if (input.partner && !input.partner.roles.includes("partner"))
    throw new Error("Sourcing account is not an active partner account");
  if (
    partnerRoute &&
    input.partnerAgreement?.partnerAgreementType &&
    (input.partnerAgreement.partnerAgreementType === "referral") !==
      (quote.route === "referral")
  )
    throw new Error("Quote route conflicts with governing partner agreement");
  if (partnerRoute) {
    if (!input.partnerAgreement)
      throw new Error(
        "Partner-sourced order requires the active partner agreement",
      );
    if (
      input.partnerAgreement.accountId !== input.partner?.id ||
      (input.partnerAgreement.status !== "active" &&
        input.partnerAgreement.status !== "in_notice")
    )
      throw new Error(
        "Partner agreement is inactive or belongs to another account",
      );
  }
  const governingAgreement =
    quote.route === "resale" || quote.route === "distributor"
      ? input.partnerAgreement
      : input.agreement;
  if (!governingAgreement)
    throw new Error("Governing agreement could not be resolved");
  if (
    governingAgreement.status !== "active" &&
    governingAgreement.status !== "in_notice"
  )
    throw new Error("A current governing agreement is required");
  if (governingAgreement.effectiveOn > input.serviceStartsOn)
    throw new Error(
      "Governing agreement is not effective on the service start date",
    );
  const expectedAgreementAccount =
    quote.route === "resale" || quote.route === "distributor"
      ? input.partner?.id
      : input.buyer.id;
  if (governingAgreement.accountId !== expectedAgreementAccount)
    throw new Error("Governing agreement belongs to another commercial party");
  const end = input.coTerminateOn ?? input.serviceEndsOn;
  if (end && end < input.serviceStartsOn)
    throw new Error("Service end precedes service start");
  if (
    input.coTerminateOn &&
    input.serviceEndsOn &&
    input.coTerminateOn > input.serviceEndsOn
  )
    throw new Error(
      "Co-termination cannot extend beyond the originally quoted term",
    );
  const partner = input.partner;
  let invoicingAccountId = input.buyer.id;
  if (quote.route === "resale" || quote.route === "distributor") {
    if (!partner)
      throw new Error("Resale order requires its invoicing partner");
    invoicingAccountId = partner.id;
  }
  const merchantOfRecord =
    quote.route === "resale" || quote.route === "distributor"
      ? "partner"
      : quote.route === "marketplace"
        ? "marketplace"
        : "fil_one";
  return Object.freeze({
    id: input.orderId,
    quoteId: quote.id,
    quoteRevision: quote.revision,
    agreementId: governingAgreement.id,
    agreementVersion: governingAgreement.version,
    accountId: input.buyer.id,
    invoicingAccountId,
    ...(input.partner ? { partnerAccountId: input.partner.id } : {}),
    merchantOfRecord,
    sourcing: quote.route,
    ...(input.poNumber ? { poNumber: input.poNumber } : {}),
    ...(input.poDocumentId ? { poDocumentId: input.poDocumentId } : {}),
    signerUserId: input.signerUserId,
    authorityTitle: input.authorityTitle,
    authorityAttested: true,
    status: "accepted",
    serviceStartsOn: input.serviceStartsOn,
    ...(end ? { serviceEndsOn: end } : {}),
    ...(input.noticeOn ? { noticeOn: input.noticeOn } : {}),
    lines: Object.freeze(
      quote.lines.map((line, index) => {
        const orderLineId = input.orderLineIds[index];
        if (!orderLineId) throw new Error("Order-line identifier is missing");
        return toOrderLine(line, orderLineId);
      }),
    ),
    acceptedAt: input.acceptedAt,
    orderFormDocumentId: input.orderFormDocumentId,
    provisioningKey: `order:${input.orderId}:v1:provision`,
  });
}

export function provisioningRequest(
  order: AcceptedOrder,
  organizationId: string,
): Parameters<ProvisioningPort["provision"]>[0] {
  if (order.status !== "accepted" && order.status !== "provisioning")
    throw new Error("Only an accepted order can provision");
  return {
    orderId: order.id as Parameters<
      ProvisioningPort["provision"]
    >[0]["orderId"],
    organizationId: organizationId as Parameters<
      ProvisioningPort["provision"]
    >[0]["organizationId"],
    entitlements: order.lines.map((line) => ({
      sku: line.sku,
      quantity: line.quantity,
      region: line.region,
    })),
    idempotencyKey: order.provisioningKey as Parameters<
      ProvisioningPort["provision"]
    >[0]["idempotencyKey"],
  };
}

export function orderRevenue(order: AcceptedOrder): Money {
  const currency = order.lines[0]?.lineTotal.currency;
  if (!currency) throw new Error("Order has no lines");
  const minor = order.lines.reduce((sum, line) => {
    if (line.lineTotal.currency !== currency)
      throw new Error("Order contains mixed currencies");
    return sum + BigInt(line.lineTotal.minor);
  }, 0n);
  return { currency, minor: minor.toString() } as Money;
}
