"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { uuidV7 } from "@clockwork/contracts";
import { Button, Input, Select, Textarea } from "@clockwork/ui";

import {
  CommerceApiError,
  convertPoc,
  createInvoicePaymentSession,
  decideException,
  declineRenewal,
  downloadReportCsv,
  executeClickAgreement,
  getActiveAgreementTemplate,
  inviteOrganizationMember,
  publishAgreementTemplate,
  readReport,
  registerPartnerDomain,
  reportNames,
  requestOffboarding,
  requestPoc,
  requestRenewal,
  sendCoreCommand,
  updateProcurementProfile,
  type ActiveAgreementTemplate,
  type ReportName,
} from "@/src/features/contracts/commerce-client";
import { trustedStripePaymentUrl } from "@/src/features/contracts/provider-navigation";

import type { SurfaceConfig, SurfaceKey } from "./surface-catalog";

const ids = {
  account: "11111111-1111-4111-8111-111111111111",
  partner: "22222222-2222-4222-8222-222222222222",
  endClient: "33333333-3333-4333-8333-333333333333",
  priceBook: "44444444-4444-4444-8444-444444444444",
  template: "55555555-5555-4555-8555-555555555555",
  user: "66666666-6666-4666-8666-666666666666",
  owner: "77777777-7777-4777-8777-777777777777",
  quote: "88888888-8888-4888-8888-888888888888",
  agreement: "99999999-9999-4999-8999-999999999999",
  document: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orderLine: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  order: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  poc: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  invoice: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  payment: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeef",
  organization: "ffffffff-ffff-4fff-8fff-ffffffffffff",
} as const;

const runtimeEnvironment =
  process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? process.env.NODE_ENV;
const demoFallbackAllowed = ["development", "test"].includes(
  runtimeEnvironment ?? "",
);

const titles: Record<NonNullable<SurfaceConfig["workflow"]>, string> = {
  quote: "Create a priced quote",
  agreement: "Accept click-through terms",
  order: "Accept quote and create order",
  poc: "Request or convert a proof of concept",
  renewal: "Renew or decline renewal",
  offboarding: "Request controlled offboarding",
  registration: "Register an end-client deal",
  reports: "Run a traceable report",
  payment: "Invoice payment",
  account: "Account update",
  invite: "Invite an organization member",
  procurement: "Update procurement readiness",
  pricebook: "Create or activate a price book",
  agreementAdmin: "Publish an approved agreement template",
  brand: "Brand and custom domain",
  assisted: "Assisted action",
  approval: "Administrative approval",
  collections: "Collections and financial corrections",
  admin: "Administration",
};

function value(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function demoValue(key: keyof typeof ids): string {
  return demoFallbackAllowed ? ids[key] : "";
}

function quotePayload(data: FormData) {
  const partnerAccountId = value(data, "partnerAccountId");
  const endClientAccountId = value(data, "endClientAccountId");
  return {
    priceBookId: value(data, "priceBookId"),
    seriesId: uuidV7(),
    route: value(data, "route"),
    ...(endClientAccountId ? { endClientAccountId } : {}),
    ...(partnerAccountId ? { partnerAccountId } : {}),
    lines: [
      {
        lineId: uuidV7(),
        sku: value(data, "sku"),
        region: value(data, "region"),
        quantity: value(data, "capacity"),
        termMonths: Number(value(data, "termMonths")),
      },
    ],
    expiresAt: new Date(value(data, "expiresAt")).toISOString(),
  };
}

function mutationFields(
  workflow: NonNullable<SurfaceConfig["workflow"]>,
  surface: SurfaceKey,
  activeAgreementTemplate?: ActiveAgreementTemplate,
): ReactNode {
  if (workflow === "agreement")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Agreement template ID"
          name="templateId"
          value={activeAgreementTemplate?.id ?? ""}
          readOnly
          help="Selected from the active counsel-approved CSA record."
          required
        />
        <Input
          label="Template version"
          name="templateVersion"
          value={activeAgreementTemplate?.semanticVersion ?? ""}
          readOnly
          required
        />
        <Textarea
          label="Exact agreement text"
          name="exactText"
          value={activeAgreementTemplate?.exactText ?? ""}
          readOnly
          help="Read-only exact text. The server verifies this text against the approved SHA-256 hash."
          required
        />
        <Input
          label="Approved text SHA-256"
          name="exactTextHash"
          value={activeAgreementTemplate?.exactTextHash ?? ""}
          readOnly
          required
        />
        <Input
          label="Authority title"
          name="authorityTitle"
          defaultValue="Chief Operating Officer"
          required
        />
        <label className="checkbox-field">
          <input type="checkbox" name="authority" required />
          <span>I am authorized to bind this legal entity</span>
        </label>
      </>
    );

  if (workflow === "quote")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={
            surface === "partnerQuotes"
              ? demoValue("endClient")
              : demoValue("account")
          }
          help={
            surface === "partnerQuotes"
              ? "The end-client legal entity receiving and using the service."
              : undefined
          }
          required
        />
        <Input
          label="Price book ID"
          name="priceBookId"
          defaultValue={demoValue("priceBook")}
          required
        />
        <Select
          label="Commercial route"
          name="route"
          defaultValue={surface === "partnerQuotes" ? "resale" : "direct"}
          options={[
            { value: "direct", label: "Direct" },
            { value: "referral", label: "Referral" },
            { value: "resale", label: "Resale" },
            { value: "distributor", label: "Distributor / two-tier" },
            { value: "marketplace", label: "Marketplace" },
          ]}
        />
        <Input
          label="End-client account ID"
          name="endClientAccountId"
          defaultValue={
            surface === "partnerQuotes" ? demoValue("endClient") : ""
          }
          optionalLabel="Optional"
        />
        <Input
          label="Partner account ID"
          name="partnerAccountId"
          defaultValue={surface === "partnerQuotes" ? demoValue("partner") : ""}
          optionalLabel="Optional"
        />
        <Input
          label="SKU"
          name="sku"
          defaultValue="FIL-ARCHIVE-CAPACITY"
          required
        />
        <Select
          label="Data region"
          name="region"
          defaultValue="us-east"
          options={[
            { value: "us-east", label: "US East" },
            { value: "eu-west", label: "EU West" },
            { value: "uk-south", label: "UK South" },
          ]}
        />
        <Input
          label="Committed capacity"
          name="capacity"
          inputMode="decimal"
          defaultValue="120"
          min="10"
          required
        />
        <Input
          label="Term months"
          name="termMonths"
          type="number"
          defaultValue="12"
          min="1"
          required
        />
        <Input
          label="Quote expires at"
          name="expiresAt"
          type="datetime-local"
          defaultValue="2026-08-31T17:00"
          required
        />
      </>
    );

  if (workflow === "order")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Accepted quote ID"
          name="quoteId"
          defaultValue={demoValue("quote")}
          required
        />
        <Input
          label="Executed agreement ID"
          name="agreementId"
          defaultValue={demoValue("agreement")}
          required
        />
        <Input
          label="Signer user ID"
          name="signerUserId"
          defaultValue={demoValue("user")}
          required
        />
        <Input
          label="Authority title"
          name="authorityTitle"
          defaultValue="Chief Operating Officer"
          required
        />
        <label className="checkbox-field">
          <input type="checkbox" name="authority" required />
          <span>I am authorized to accept this order</span>
        </label>
        <Input
          label="Purchase order number"
          name="poNumber"
          defaultValue="PO-2026-0042"
          optionalLabel="Optional"
        />
        <Input
          label="Purchase order document ID"
          name="poDocumentId"
          defaultValue={demoValue("document")}
          optionalLabel="Optional"
        />
        <Input
          label="Order form document ID"
          name="orderFormDocumentId"
          defaultValue={demoValue("document")}
          required
        />
        <Input
          label="Order line ID"
          name="orderLineId"
          defaultValue={demoValue("orderLine")}
          required
        />
        <Input
          label="Service starts on"
          name="serviceStartsOn"
          type="date"
          defaultValue="2026-08-01"
          required
        />
      </>
    );

  if (workflow === "payment")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Open invoice ID"
          name="invoiceId"
          defaultValue={demoValue("invoice")}
          required
        />
        <p className="form-message">
          Clockwork opens Stripe&apos;s hosted invoice page. Payment status
          remains pending until a signed Stripe webhook confirms settlement.
        </p>
      </>
    );

  if (workflow === "assisted")
    return (
      <>
        <p className="form-message">
          This creates the same customer quote as self-service. The server—not
          this form—records the actual staff actor, effective customer actor,
          target account, and reason from the active time-limited assisted
          session.
        </p>
        {mutationFields("quote", surface, activeAgreementTemplate)}
        <label className="checkbox-field">
          <input type="checkbox" name="assistedSessionConfirmed" required />
          <span>
            I confirm the active assisted session names the customer request and
            target account
          </span>
        </label>
      </>
    );

  if (workflow === "poc")
    return (
      <>
        <Select
          label="POC action"
          name="pocAction"
          defaultValue="request"
          options={[
            { value: "request", label: "Request isolated POC" },
            { value: "convert", label: "Convert without moving data" },
          ]}
        />
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={
            surface === "sandboxes"
              ? demoValue("endClient")
              : demoValue("account")
          }
          required
        />
        <Input
          label="Partner account ID"
          name="partnerAccountId"
          defaultValue={surface === "sandboxes" ? demoValue("partner") : ""}
          optionalLabel="Optional"
        />
        <Input
          label="POC ID"
          name="pocId"
          defaultValue={demoValue("poc")}
          help="Required only for conversion."
        />
        <Input
          label="Buyer user ID"
          name="buyerUserId"
          defaultValue={demoValue("user")}
        />
        <Input
          label="Support owner ID"
          name="supportOwnerId"
          defaultValue={demoValue("owner")}
        />
        <Input
          label="Workload"
          name="workload"
          defaultValue="Immutable archive validation"
        />
        <Select
          label="Permitted data class"
          name="permittedDataClass"
          defaultValue="confidential"
          options={[
            { value: "synthetic", label: "Synthetic" },
            { value: "public", label: "Public" },
            { value: "confidential", label: "Confidential" },
            { value: "regulated", label: "Regulated" },
          ]}
        />
        <Input
          label="Success test"
          name="successTest"
          defaultValue="Restore validation completes within the agreed recovery objective"
        />
        <Input
          label="Success target"
          name="successTarget"
          defaultValue="100% of the validation suite passes"
        />
        <Input
          label="Capacity cap (TB)"
          name="capacityCap"
          inputMode="decimal"
          defaultValue="10"
        />
        <Input
          label="Egress cap (TB)"
          name="egressCap"
          inputMode="decimal"
          defaultValue="2"
        />
        <Input
          label="Expires at"
          name="expiresAt"
          type="datetime-local"
          defaultValue="2026-08-31T17:00"
        />
        <Input
          label="Paid quote ID"
          name="quoteId"
          defaultValue={demoValue("quote")}
          help="Required only for conversion."
        />
        <Input
          label="Paid order ID"
          name="orderId"
          defaultValue={demoValue("order")}
          help="Required only for conversion."
        />
      </>
    );

  if (workflow === "renewal")
    return (
      <>
        <Select
          label="Renewal action"
          name="renewalAction"
          defaultValue="renew"
          options={[
            { value: "renew", label: "Renew" },
            { value: "change_term", label: "Change term" },
            { value: "request_change", label: "Request commercial change" },
            { value: "decline", label: "Decline renewal" },
          ]}
        />
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Order ID"
          name="orderId"
          defaultValue={demoValue("order")}
          required
        />
        <Input
          label="Requested term months"
          name="requestedTermMonths"
          type="number"
          defaultValue="12"
          min="1"
        />
        <Textarea
          label="Decline reason"
          name="reason"
          defaultValue="Capacity will not be required after the current term."
          help="Required only when declining."
        />
        <Input
          label="Authority title"
          name="authorityTitle"
          defaultValue="Chief Operating Officer"
        />
        <Input
          label="Decline evidence document ID"
          name="evidenceDocumentId"
          defaultValue={demoValue("document")}
        />
        <label className="checkbox-field">
          <input type="checkbox" name="authority" required />
          <span>I am authorized to submit this renewal decision</span>
        </label>
      </>
    );

  if (workflow === "offboarding")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Order ID"
          name="orderId"
          defaultValue={demoValue("order")}
          required
        />
        <Select
          label="Termination reason"
          name="reason"
          defaultValue="customer_request"
          options={[
            { value: "customer_request", label: "Customer request" },
            { value: "non_renewal", label: "Non-renewal" },
            { value: "partner_request", label: "Partner request" },
            { value: "partner_default", label: "Partner default" },
            { value: "material_breach", label: "Material breach" },
          ]}
        />
        <Input
          label="Effective at"
          name="effectiveAt"
          type="datetime-local"
          defaultValue="2026-12-31T23:59"
          required
        />
        <Input
          label="Retrieval window days"
          name="retrievalDays"
          type="number"
          defaultValue="30"
          min="0"
          required
        />
        <p className="form-message">
          This request enters two-person approval. It does not tear down service
          immediately.
        </p>
      </>
    );

  if (workflow === "registration")
    return (
      <>
        <Input
          label="Partner account ID"
          name="partnerAccountId"
          defaultValue={demoValue("partner")}
          required
        />
        <Input
          label="End-client account ID"
          name="endClientAccountId"
          defaultValue={demoValue("endClient")}
          required
        />
        <Input
          label="Workload"
          name="workload"
          defaultValue="Immutable archive"
          required
        />
        <Input
          label="Expected volume"
          name="expectedVolume"
          defaultValue="120 TB"
          required
        />
        <Input
          label="Protection days"
          name="protectionDays"
          type="number"
          defaultValue="90"
          min="1"
          required
        />
      </>
    );

  if (workflow === "brand")
    return (
      <>
        <Input
          label="Partner account ID"
          name="accountId"
          defaultValue={demoValue("partner")}
          required
        />
        <Input
          label="Custom domain"
          name="domain"
          defaultValue={demoFallbackAllowed ? "commerce.meridian.example" : ""}
          required
        />
        <Input
          label="DNS verification token"
          name="verificationToken"
          defaultValue={
            demoFallbackAllowed ? "clockwork-demo-verification" : ""
          }
          required
        />
        <Input
          label="Brand name"
          name="brandName"
          defaultValue={demoFallbackAllowed ? "Meridian Channel Group" : ""}
          required
        />
        <Input
          label="Logo URL"
          name="logoUrl"
          type="url"
          optionalLabel="Optional"
        />
        <Input
          label="Primary color"
          name="primaryColor"
          type="color"
          defaultValue="#3157d5"
          required
        />
        <Select
          label="Communication owner"
          name="communicationOwner"
          defaultValue="partner"
          options={[
            { value: "partner", label: "Partner" },
            { value: "fil_one", label: "Fil One" },
          ]}
        />
      </>
    );

  if (workflow === "approval")
    return (
      <>
        <Input
          label="Exception case ID"
          name="caseId"
          defaultValue={demoValue("poc")}
          required
        />
        <Select
          label="Decision"
          name="decision"
          defaultValue="approved"
          options={[
            { value: "approved", label: "Approve" },
            { value: "rejected", label: "Reject" },
          ]}
        />
        <Textarea
          label="Decision reason"
          name="reason"
          minLength={8}
          required
        />
        <Input
          label="Evidence document ID"
          name="evidenceDocumentId"
          defaultValue={demoValue("document")}
          required
        />
      </>
    );

  if (workflow === "collections")
    return (
      <>
        <Select
          label="Collections action"
          name="collectionsAction"
          defaultValue="evaluate_dunning"
          options={[
            { value: "evaluate_dunning", label: "Evaluate dunning" },
            { value: "issue_credit", label: "Issue credit note" },
            { value: "submit_refund", label: "Submit refund" },
            { value: "record_dispute", label: "Record Stripe dispute" },
          ]}
        />
        <Input
          label="Billing account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Invoice ID"
          name="invoiceId"
          defaultValue={demoValue("invoice")}
          required
        />
        <Input
          label="Payment ID"
          name="paymentId"
          defaultValue={demoValue("payment")}
          optionalLabel="Required for refunds and disputes"
        />
        <Select
          label="Currency"
          name="currency"
          defaultValue="USD"
          options={[
            { value: "USD", label: "USD" },
            { value: "EUR", label: "EUR" },
            { value: "GBP", label: "GBP" },
          ]}
        />
        <Input
          label="Amount in minor units"
          name="amountMinor"
          inputMode="numeric"
          optionalLabel="Required for corrections"
        />
        <Input
          label="Stripe object ID"
          name="providerReference"
          optionalLabel="Required for corrections"
        />
        <Textarea
          label="Internal reason code"
          name="reasonCode"
          optionalLabel="Required for credits and refunds"
        />
        <Input
          label="Dispute evidence due at"
          name="evidenceDueAt"
          type="datetime-local"
          optionalLabel="Required for disputes"
        />
      </>
    );

  if (workflow === "account")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input
          label="Current row version"
          name="rowVersion"
          type="number"
          min="1"
          defaultValue="1"
          required
        />
        <Input label="Legal name" name="legalName" required />
        <Input
          label="Invoice delivery email"
          name="invoiceDeliveryEmail"
          type="email"
          required
        />
        <Input
          label="Billing contact name"
          name="billingContactName"
          required
        />
        <Input
          label="Billing contact email"
          name="billingContactEmail"
          type="email"
          required
        />
      </>
    );

  if (workflow === "invite")
    return (
      <>
        <Input
          label="Organization ID"
          name="organizationId"
          defaultValue={demoValue("organization")}
          required
        />
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input label="Invitee email" name="email" type="email" required />
        <Select
          label="Role"
          name="role"
          defaultValue="member"
          options={[
            { value: "owner", label: "Owner" },
            { value: "admin", label: "Admin" },
            { value: "billing", label: "Billing" },
            { value: "member", label: "Member" },
          ]}
        />
        <Input
          label="Invite expires at"
          name="expiresAt"
          type="datetime-local"
          required
        />
      </>
    );

  if (workflow === "procurement")
    return (
      <>
        <Input
          label="Account ID"
          name="accountId"
          defaultValue={demoValue("account")}
          required
        />
        <Input label="AP contact name" name="apName" required />
        <Input label="AP contact email" name="apEmail" type="email" required />
        <Input
          label="Invoice delivery email"
          name="invoiceDeliveryEmail"
          type="email"
          required
        />
        <label className="checkbox-field">
          <input type="checkbox" name="poRequired" />
          <span>A purchase order is required</span>
        </label>
      </>
    );

  if (workflow === "pricebook")
    return (
      <>
        <Select
          label="Action"
          name="priceBookAction"
          defaultValue="create"
          options={[
            { value: "create", label: "Create draft" },
            { value: "activate", label: "Activate draft" },
          ]}
        />
        <Input label="Price book ID" name="priceBookId" required />
        <Input label="Name" name="name" required />
        <Select
          label="Currency"
          name="currency"
          defaultValue="USD"
          options={[
            { value: "USD", label: "USD" },
            { value: "EUR", label: "EUR" },
            { value: "GBP", label: "GBP" },
          ]}
        />
        <Input
          label="Effective from"
          name="effectiveFrom"
          type="date"
          required
        />
        <Input
          label="Version"
          name="version"
          type="number"
          min="1"
          defaultValue="1"
          required
        />
      </>
    );

  if (workflow === "agreementAdmin")
    return (
      <>
        <Input
          label="Agreement type"
          name="agreementType"
          defaultValue="csa"
          required
        />
        <Input
          label="Semantic version"
          name="semanticVersion"
          defaultValue="1.0.0"
          required
        />
        <Input
          label="Jurisdiction"
          name="jurisdiction"
          defaultValue="US"
          required
        />
        <Input label="Effective on" name="effectiveOn" type="date" required />
        <Input
          label="Canonical document ID"
          name="canonicalDocumentId"
          required
        />
        <Textarea label="Exact approved text" name="exactText" required />
        <Select
          label="Execution mode"
          name="executionMode"
          defaultValue="click_through"
          options={[
            { value: "click_through", label: "Click-through" },
            { value: "counter_signed", label: "Counter-signed" },
          ]}
        />
        <Input
          label="Approval evidence document ID"
          name="approvalEvidenceDocumentId"
          required
        />
      </>
    );

  return null;
}

function reportFields() {
  return (
    <>
      <Select
        label="Report"
        name="report"
        defaultValue={reportNames[0]}
        options={reportNames.map((report) => ({
          value: report,
          label: report.replaceAll("_", " "),
        }))}
      />
      <Input label="Account ID" name="accountId" optionalLabel="Optional" />
    </>
  );
}

export function WorkflowPanel({
  workflow,
  surface,
}: {
  workflow: NonNullable<SurfaceConfig["workflow"]>;
  surface: SurfaceKey;
}) {
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [reportResult, setReportResult] = useState<unknown>(null);
  const [providerAction, setProviderAction] = useState<{
    href: string;
    label: string;
  } | null>(null);
  const [activeAgreementTemplate, setActiveAgreementTemplate] =
    useState<ActiveAgreementTemplate>();
  const [agreementTemplateLoading, setAgreementTemplateLoading] = useState(
    workflow === "agreement",
  );
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (workflow !== "agreement") return;
    let active = true;
    setAgreementTemplateLoading(true);
    getActiveAgreementTemplate({ type: "csa", jurisdiction: "US" })
      .then((template) => {
        if (!active) return;
        setActiveAgreementTemplate(template);
        setError("");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "The approved agreement text could not be loaded.",
        );
        window.setTimeout(() => errorRef.current?.focus(), 0);
      })
      .finally(() => {
        if (active) setAgreementTemplateLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workflow]);

  const showError = (message: string) => {
    setError(message);
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setSuccess("");
    setReportResult(null);
    setProviderAction(null);
    if (!form.checkValidity()) {
      form.reportValidity();
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    const data = new FormData(form);
    if (
      (workflow === "quote" || workflow === "assisted") &&
      Number(value(data, "capacity")) < 10
    ) {
      setError("Enter a committed capacity of at least 10 TB.");
      form.querySelector<HTMLInputElement>("[name=capacity]")?.focus();
      return;
    }

    setPending(true);
    try {
      let result: unknown;
      if (workflow === "agreement") {
        if (!activeAgreementTemplate)
          throw new Error(
            "The approved agreement text is not loaded. Reload and try again.",
          );
        const observedHash = await sha256(activeAgreementTemplate.exactText);
        if (observedHash !== activeAgreementTemplate.exactTextHash)
          throw new Error(
            "The approved agreement text failed its integrity check. Nothing was accepted.",
          );
        result = await executeClickAgreement({
          accountId: value(data, "accountId"),
          templateId: activeAgreementTemplate.id,
          templateVersion: activeAgreementTemplate.semanticVersion,
          exactText: activeAgreementTemplate.exactText,
          exactTextHash: activeAgreementTemplate.exactTextHash,
          authorityTitle: value(data, "authorityTitle"),
        });
      } else if (workflow === "quote" || workflow === "assisted") {
        result = await sendCoreCommand({
          resource: "quotes",
          id: uuidV7(),
          accountId: value(data, "accountId"),
          action: "create",
          payload: quotePayload(data),
        });
      } else if (workflow === "order") {
        const poNumber = value(data, "poNumber");
        const poDocumentId = value(data, "poDocumentId");
        result = await sendCoreCommand({
          resource: "orders",
          id: uuidV7(),
          accountId: value(data, "accountId"),
          action: "create",
          payload: {
            quoteId: value(data, "quoteId"),
            agreementId: value(data, "agreementId"),
            signerUserId: value(data, "signerUserId"),
            authorityTitle: value(data, "authorityTitle"),
            authorityAttested: true,
            ...(poNumber ? { poNumber } : {}),
            ...(poDocumentId ? { poDocumentId } : {}),
            acceptedAt: new Date().toISOString(),
            serviceStartsOn: value(data, "serviceStartsOn"),
            orderFormDocumentId: value(data, "orderFormDocumentId"),
            orderLineIds: [value(data, "orderLineId")],
          },
        });
      } else if (workflow === "payment") {
        const session = await createInvoicePaymentSession({
          accountId: value(data, "accountId"),
          invoiceId: value(data, "invoiceId"),
        });
        const href = trustedStripePaymentUrl(session.url);
        setProviderAction({ href, label: "Continue to secure Stripe payment" });
        result = session;
      } else if (workflow === "poc") {
        result =
          value(data, "pocAction") === "convert"
            ? await convertPoc({
                pocId: value(data, "pocId"),
                accountId: value(data, "accountId"),
                quoteId: value(data, "quoteId"),
                orderId: value(data, "orderId"),
              })
            : await requestPoc({
                accountId: value(data, "accountId"),
                partnerAccountId: value(data, "partnerAccountId") || null,
                workload: value(data, "workload"),
                buyerUserId: value(data, "buyerUserId"),
                permittedDataClass: value(data, "permittedDataClass"),
                successTests: [
                  {
                    id: uuidV7(),
                    description: value(data, "successTest"),
                    target: value(data, "successTarget"),
                  },
                ],
                capacityCap: value(data, "capacityCap"),
                egressCap: value(data, "egressCap"),
                expiresAt: new Date(value(data, "expiresAt")).toISOString(),
                supportOwnerId: value(data, "supportOwnerId"),
              });
      } else if (workflow === "renewal") {
        const action = value(data, "renewalAction");
        result =
          action === "decline"
            ? await declineRenewal({
                orderId: value(data, "orderId"),
                accountId: value(data, "accountId"),
                reason: value(data, "reason"),
                authorityTitle: value(data, "authorityTitle"),
                evidenceDocumentId: value(data, "evidenceDocumentId"),
              })
            : await requestRenewal({
                orderId: value(data, "orderId"),
                accountId: value(data, "accountId"),
                requestedAction: action as
                  "renew" | "change_term" | "request_change",
                requestedTermMonths:
                  Number(value(data, "requestedTermMonths")) || null,
              });
      } else if (workflow === "offboarding") {
        result = await requestOffboarding({
          accountId: value(data, "accountId"),
          orderId: value(data, "orderId"),
          reason: value(data, "reason") as
            | "customer_request"
            | "non_renewal"
            | "partner_request"
            | "partner_default"
            | "material_breach",
          effectiveAt: new Date(value(data, "effectiveAt")).toISOString(),
          retrievalDays: Number(value(data, "retrievalDays")),
          partnerAccountId: null,
        });
      } else if (workflow === "registration") {
        result = await sendCoreCommand({
          resource: "deal_registrations",
          id: uuidV7(),
          accountId: value(data, "partnerAccountId"),
          action: "create",
          payload: {
            partnerAccountId: value(data, "partnerAccountId"),
            endClientAccountId: value(data, "endClientAccountId"),
            workload: value(data, "workload"),
            expectedVolume: value(data, "expectedVolume"),
            protectionDays: Number(value(data, "protectionDays")),
            houseAccountIds: [],
          },
        });
      } else if (workflow === "brand") {
        const logoUrl = value(data, "logoUrl");
        result = await registerPartnerDomain({
          accountId: value(data, "accountId"),
          domain: value(data, "domain"),
          verificationToken: value(data, "verificationToken"),
          brandName: value(data, "brandName"),
          logoUrl: logoUrl || null,
          primaryColor: value(data, "primaryColor"),
          communicationOwner: value(data, "communicationOwner") as
            "fil_one" | "partner",
        });
      } else if (workflow === "approval") {
        result = await decideException({
          caseId: value(data, "caseId"),
          decision: value(data, "decision") as "approved" | "rejected",
          reason: value(data, "reason"),
          evidenceDocumentId: value(data, "evidenceDocumentId"),
        });
      } else if (workflow === "collections") {
        const action = value(data, "collectionsAction");
        const accountId = value(data, "accountId");
        const invoiceId = value(data, "invoiceId");
        const paymentId = value(data, "paymentId");
        const providerReference = value(data, "providerReference");
        const amount = {
          currency: value(data, "currency"),
          minor: value(data, "amountMinor"),
        };
        result =
          action === "evaluate_dunning"
            ? await sendCoreCommand({
                resource: "invoices",
                id: invoiceId,
                accountId,
                action,
                payload: {},
              })
            : action === "issue_credit"
              ? await sendCoreCommand({
                  resource: "credit_notes",
                  id: uuidV7(),
                  accountId,
                  action: "issue",
                  payload: {
                    invoiceId,
                    stripeCreditNoteId: providerReference,
                    amount,
                    reasonCode: value(data, "reasonCode"),
                  },
                })
              : action === "submit_refund"
                ? await sendCoreCommand({
                    resource: "refunds",
                    id: uuidV7(),
                    accountId,
                    action: "submit",
                    payload: {
                      paymentId,
                      stripeRefundId: providerReference,
                      amount,
                      reasonCode: value(data, "reasonCode"),
                    },
                  })
                : await sendCoreCommand({
                    resource: "disputes",
                    id: uuidV7(),
                    accountId,
                    action: "create",
                    payload: {
                      paymentId,
                      stripeDisputeId: providerReference,
                      amount,
                      evidenceDueAt: new Date(
                        value(data, "evidenceDueAt"),
                      ).toISOString(),
                    },
                  });
      } else if (workflow === "account") {
        result = await sendCoreCommand({
          resource: "accounts",
          id: value(data, "accountId"),
          accountId: value(data, "accountId"),
          action: "update",
          expectedVersion: Number(value(data, "rowVersion")),
          payload: {
            legalName: value(data, "legalName"),
            invoiceDeliveryEmail: value(data, "invoiceDeliveryEmail"),
            billingContact: {
              name: value(data, "billingContactName"),
              email: value(data, "billingContactEmail"),
            },
          },
        });
      } else if (workflow === "invite") {
        result = await inviteOrganizationMember({
          organizationId: value(data, "organizationId"),
          accountId: value(data, "accountId"),
          email: value(data, "email"),
          role: value(data, "role") as "owner" | "admin" | "billing" | "member",
          expiresAt: new Date(value(data, "expiresAt")).toISOString(),
        });
      } else if (workflow === "procurement") {
        result = await updateProcurementProfile({
          accountId: value(data, "accountId"),
          apContact: {
            name: value(data, "apName"),
            email: value(data, "apEmail"),
          },
          invoiceDeliveryEmail: value(data, "invoiceDeliveryEmail"),
          poRequired: data.get("poRequired") === "on",
        });
      } else if (workflow === "pricebook") {
        const action = value(data, "priceBookAction");
        result = await sendCoreCommand({
          resource: "price_books",
          id: value(data, "priceBookId"),
          action,
          payload:
            action === "create"
              ? {
                  name: value(data, "name"),
                  currency: value(data, "currency"),
                  effectiveFrom: value(data, "effectiveFrom"),
                  version: Number(value(data, "version")),
                }
              : {},
        });
      } else if (workflow === "agreementAdmin") {
        const exactText = value(data, "exactText");
        result = await publishAgreementTemplate({
          type: value(data, "agreementType"),
          semanticVersion: value(data, "semanticVersion"),
          jurisdiction: value(data, "jurisdiction"),
          effectiveOn: value(data, "effectiveOn"),
          canonicalDocumentId: value(data, "canonicalDocumentId"),
          exactText,
          exactTextHash: await sha256(exactText),
          executionMode: value(data, "executionMode") as
            "click_through" | "counter_signed",
          approvalEvidenceDocumentId: value(data, "approvalEvidenceDocumentId"),
        });
      } else if (workflow === "reports") {
        result = await readReport({
          report: value(data, "report") as ReportName,
          ...(value(data, "accountId")
            ? { accountId: value(data, "accountId") }
            : {}),
        });
        setReportResult(result);
      }
      setSuccess(
        workflow === "reports"
          ? "Report loaded from source records."
          : workflow === "payment"
            ? "Secure payment session ready. Invoice status changes only after Stripe confirms payment."
            : "Request accepted. The server record is now the source of truth.",
      );
    } catch (caught) {
      if (
        caught instanceof CommerceApiError &&
        caught.code === "unavailable" &&
        demoFallbackAllowed
      ) {
        setSuccess(
          "Development simulation accepted. No production record was created.",
        );
      } else
        showError(
          caught instanceof Error
            ? caught.message
            : "The request failed. Nothing was changed.",
        );
    } finally {
      setPending(false);
    }
  };

  const download = async (form: HTMLFormElement) => {
    setPending(true);
    setError("");
    setSuccess("");
    const data = new FormData(form);
    const report = value(data, "report") as ReportName;
    try {
      const csv = await downloadReportCsv({
        report,
        ...(value(data, "accountId")
          ? { accountId: value(data, "accountId") }
          : {}),
      });
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${report}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess("CSV export downloaded from source records.");
    } catch (caught) {
      showError(
        caught instanceof Error
          ? caught.message
          : "The export failed. Nothing was changed.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      className="workflow-panel"
      aria-labelledby={`workflow-title-${surface}`}
    >
      <div>
        <p className="eyebrow">Server-backed action</p>
        <h2 id={`workflow-title-${surface}`}>{titles[workflow]}</h2>
      </div>
      <form
        onSubmit={(event) => {
          void run(event);
        }}
        noValidate
      >
        {workflow === "reports"
          ? reportFields()
          : mutationFields(workflow, surface, activeAgreementTemplate)}
        {agreementTemplateLoading ? (
          <p className="form-message" role="status">
            Loading the active counsel-approved CSA text…
          </p>
        ) : null}
        {error ? (
          <p
            ref={errorRef}
            tabIndex={-1}
            className="form-message form-message--error"
            id="workflow-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {pending ? (
          <p className="form-message" role="status">
            Submitting securely…
          </p>
        ) : null}
        {success ? (
          <p className="form-message form-message--success" role="status">
            {success}
          </p>
        ) : null}
        {providerAction ? (
          <p className="form-message form-message--success">
            <a
              className="cw-button cw-button--primary"
              href={providerAction.href}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {providerAction.label}
            </a>
          </p>
        ) : null}
        {reportResult ? (
          <pre className="form-message" aria-label="Report result">
            {JSON.stringify(reportResult, null, 2)}
          </pre>
        ) : null}
        <div className="form-actions">
          <Button
            type="submit"
            disabled={
              pending || (workflow === "agreement" && !activeAgreementTemplate)
            }
          >
            {workflow === "reports"
              ? "View report"
              : workflow === "payment"
                ? "Open secure payment"
                : workflow === "assisted"
                  ? "Create assisted quote"
                  : "Submit securely"}
          </Button>
          {workflow === "reports" ? (
            <Button
              variant="secondary"
              type="button"
              disabled={pending}
              onClick={(event) => {
                const form = event.currentTarget.form;
                if (!form) {
                  setError(
                    "The report form is unavailable. Reload and try again.",
                  );
                  return;
                }
                void download(form);
              }}
            >
              Download CSV
            </Button>
          ) : null}
          <Button
            variant="secondary"
            type="reset"
            disabled={pending}
            onClick={() => {
              setError("");
              setSuccess("");
              setReportResult(null);
              setProviderAction(null);
            }}
          >
            Clear
          </Button>
        </div>
      </form>
    </section>
  );
}
