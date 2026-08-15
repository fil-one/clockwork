"use client";

import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { uuidV7 } from "@clockwork/contracts";
import {
  Button,
  buttonClassName,
  Dialog,
  Input,
  Select,
  Textarea,
} from "@clockwork/ui";

import {
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
import { t } from "@/src/i18n/en";

import type { SurfaceKey, SurfaceWorkflow } from "./surface-catalog";

/**
 * Identifiers the route has already resolved for the record on screen.
 *
 * None of these is a value a reader can be expected to produce: each is the
 * persisted identity of a record they opened, and none of them is printed
 * anywhere a customer, partner or operator can read it. Where a route supplies
 * one, the panel carries it read-only so the reader can see what the action
 * binds to.
 *
 * Every key here is read by a `mutationFields` branch. A key nothing reads is
 * a declaration standing in for an implementation, so it does not belong. The
 * same test applies from the other side: `rowVersion` used to sit in this
 * interface and was removed, because it is not a record identity at all. It is
 * an optimistic-concurrency token compared against the *core aggregate's*
 * `row_version` (`database-finance.ts`, `input.expectedVersion !==
 * prior.rowVersion`), which is a different counter from the
 * `experience_projections.row_version` a route can reach. The version has to
 * arrive on the same authoritative read that supplies the values being edited,
 * and no surface performs that read yet, so nothing here could have populated
 * it honestly.
 */
export interface WorkflowRecordContext {
  accountId?: string;
  organizationId?: string;
  partnerAccountId?: string;
  endClientAccountId?: string;
  userId?: string;
  supportOwnerId?: string;
  priceBookId?: string;
  quoteId?: string;
  agreementId?: string;
  orderId?: string;
  pocId?: string;
  invoiceId?: string;
  paymentId?: string;
  caseId?: string;
}

const titles: Record<SurfaceWorkflow, string> = {
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

const resolvedHelp = "Taken from the record you opened.";

interface RecordIdentifierProps {
  label: string;
  name: string;
  resolved: string | undefined;
  required?: boolean;
  help?: string;
  optionalLabel?: string;
}

/**
 * The single test for "this surface cannot bind the action".
 *
 * Both the field and the panel read it, so the panel's refusal can never
 * disagree with what the form renders. There is no second per-workflow table of
 * required identifiers to keep in step -- the `required` flag on the field is
 * the only statement of the requirement.
 */
function unresolvedRequirement(
  props: RecordIdentifierProps,
): { label: string; name: string } | null {
  return props.required && !props.resolved
    ? { label: props.label, name: props.name }
    : null;
}

/**
 * A record identifier field.
 *
 * Read-only once the route resolves it. Where the route resolves nothing there
 * are two different situations and they get two different answers:
 *
 * - an identifier the command can be built without stays an ordinary editable
 *   field, because it is genuinely optional on this surface (a paid quote on a
 *   POC that is not being converted, say);
 * - an identifier the command cannot be built without renders inert. It used to
 *   render as an empty, editable, `required` box, which is how
 *   `/partner/portfolio/[id]`, `/partner/brand` and `/internal/queues/[id]`
 *   shipped a renewal, a domain registration and an approval whose Submit
 *   silently posted nothing: `checkValidity()` was false and the handler
 *   returned before it reached the network. Asking a reader to type an
 *   identifier they cannot see is not an input path, it is a dead end wearing
 *   one, so the panel says so instead.
 */
function RecordIdentifier(props: RecordIdentifierProps): ReactNode {
  const {
    label,
    name,
    resolved,
    required = false,
    help,
    optionalLabel,
  } = props;
  if (resolved)
    return (
      <Input
        label={label}
        name={name}
        value={resolved}
        readOnly
        required={required}
        help={help ? `${help} ${resolvedHelp}` : resolvedHelp}
      />
    );
  if (unresolvedRequirement(props))
    return (
      <Input
        label={label}
        name={name}
        value=""
        readOnly
        disabled
        error={`This surface does not record the ${label.toLowerCase()}, and it is not a reference anyone can be asked to type.`}
      />
    );
  return (
    <Input
      label={label}
      name={name}
      {...(help ? { help } : {})}
      {...(optionalLabel ? { optionalLabel } : {})}
    />
  );
}

/**
 * Which required identifiers a built form is missing.
 *
 * The fields are read as elements rather than reported by the component while
 * it renders, because a child component's body does not run until after its
 * parent has returned -- a collector filled during `RecordIdentifier`'s render
 * is always one paint too late to disable the submit control. `createElement`
 * has already run by the time `mutationFields` returns, so the props are here
 * to be read, and they are the same props the field itself branches on.
 */
function unresolvedIdentifiers(
  node: ReactNode,
): readonly { label: string; name: string }[] {
  const missing: { label: string; name: string }[] = [];
  const visit = (value: ReactNode): void => {
    if (Array.isArray(value)) {
      for (const child of value as ReactNode[]) visit(child);
      return;
    }
    if (!isValidElement(value)) return;
    if (value.type === RecordIdentifier) {
      const gap = unresolvedRequirement(value.props as RecordIdentifierProps);
      if (gap) missing.push(gap);
      return;
    }
    visit((value.props as { children?: ReactNode }).children);
  };
  visit(node);
  return missing;
}

function unbindableMessage(identifiers: readonly { label: string }[]): string {
  const labels = identifiers.map(({ label }) => label.toLowerCase());
  const named =
    labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `This action binds to the ${named}, which the record on this surface does not carry. Nothing can be submitted from here, and nothing was sent.`;
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

/**
 * Workflows whose submitted decision closes a commercial path. The selection
 * lives in component state because the confirmation step has to know which
 * branch is about to run before the form is read.
 */
function defaultDecision(workflow: SurfaceWorkflow): string {
  if (workflow === "renewal") return "renew";
  if (workflow === "approval") return "approved";
  return "";
}

function decisionIsDestructive(
  workflow: SurfaceWorkflow,
  decision: string,
): boolean {
  if (workflow === "offboarding") return true;
  if (workflow === "renewal") return decision === "decline";
  if (workflow === "approval") return decision === "rejected";
  return false;
}

function mutationFields({
  workflow,
  surface,
  context,
  activeAgreementTemplate,
  onDecisionChange,
}: {
  workflow: SurfaceWorkflow;
  surface: SurfaceKey;
  context: WorkflowRecordContext;
  activeAgreementTemplate?: ActiveAgreementTemplate | undefined;
  onDecisionChange?: ((decision: string) => void) | undefined;
}): ReactNode {
  if (workflow === "agreement")
    return (
      <>
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={
            surface === "partnerQuotes"
              ? context.endClientAccountId
              : context.accountId
          }
          {...(surface === "partnerQuotes"
            ? {
                help: "The end-client legal entity receiving and using the service.",
              }
            : {})}
          required
        />
        <RecordIdentifier
          label="Price book ID"
          name="priceBookId"
          resolved={context.priceBookId}
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
        <RecordIdentifier
          label="End-client account ID"
          name="endClientAccountId"
          resolved={
            surface === "partnerQuotes" ? context.endClientAccountId : undefined
          }
          optionalLabel="Optional"
        />
        <RecordIdentifier
          label="Partner account ID"
          name="partnerAccountId"
          resolved={
            surface === "partnerQuotes" ? context.partnerAccountId : undefined
          }
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
          required
        />
        <RecordIdentifier
          label="Accepted quote ID"
          name="quoteId"
          resolved={context.quoteId}
          required
        />
        <RecordIdentifier
          label="Executed agreement ID"
          name="agreementId"
          resolved={context.agreementId}
          required
        />
        <RecordIdentifier
          label="Signer user ID"
          name="signerUserId"
          resolved={context.userId}
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
          optionalLabel="Optional"
        />
        <Input
          label="Order form document ID"
          name="orderFormDocumentId"
          required
        />
        <Input label="Order line ID" name="orderLineId" required />
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
          required
        />
        <RecordIdentifier
          label="Open invoice ID"
          name="invoiceId"
          resolved={context.invoiceId}
          required
        />
        <p className="form-message">
          Fil One opens Stripe&apos;s hosted invoice page. Payment status
          remains pending until a signed Stripe webhook confirms settlement.
        </p>
      </>
    );

  if (workflow === "assisted")
    return (
      <>
        <p className="form-message">
          This creates the same customer quote as self-service. The active
          time-limited assisted session supplies the staff actor, effective
          customer actor, target account, and reason.
        </p>
        {mutationFields({
          workflow: "quote",
          surface,
          context,
          activeAgreementTemplate,
        })}
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={
            surface === "sandboxes"
              ? context.endClientAccountId
              : context.accountId
          }
          required
        />
        <RecordIdentifier
          label="Partner account ID"
          name="partnerAccountId"
          resolved={
            surface === "sandboxes" ? context.partnerAccountId : undefined
          }
          optionalLabel="Optional"
        />
        <RecordIdentifier
          label="POC ID"
          name="pocId"
          resolved={context.pocId}
          help="Required only for conversion."
        />
        <RecordIdentifier
          label="Buyer user ID"
          name="buyerUserId"
          resolved={context.userId}
        />
        <RecordIdentifier
          label="Support owner ID"
          name="supportOwnerId"
          resolved={context.supportOwnerId}
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
        <RecordIdentifier
          label="Paid quote ID"
          name="quoteId"
          resolved={context.quoteId}
          help="Required only for conversion."
        />
        <RecordIdentifier
          label="Paid order ID"
          name="orderId"
          resolved={context.orderId}
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
          onChange={(event) => onDecisionChange?.(event.target.value)}
          options={[
            { value: "renew", label: "Renew" },
            { value: "change_term", label: "Change term" },
            { value: "request_change", label: "Request commercial change" },
            { value: "decline", label: "Decline renewal" },
          ]}
        />
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
          required
        />
        <RecordIdentifier
          label="Order ID"
          name="orderId"
          resolved={context.orderId}
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
          help="Required only when declining. The server records this document as the decline's authority evidence."
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
          required
        />
        <RecordIdentifier
          label="Order ID"
          name="orderId"
          resolved={context.orderId}
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
        <RecordIdentifier
          label="Partner account ID"
          name="partnerAccountId"
          resolved={context.partnerAccountId}
          required
        />
        <RecordIdentifier
          label="End-client account ID"
          name="endClientAccountId"
          resolved={context.endClientAccountId}
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
        <RecordIdentifier
          label="Partner account ID"
          name="accountId"
          resolved={context.partnerAccountId}
          required
        />
        {/*
         * These three are the partner's own answers -- a domain they control,
         * the token their DNS provider issued, the name they trade under -- so
         * they are the only fields on this form a reader can be asked for. They
         * used to be pre-filled with a fixture partner's domain, token and name
         * whenever the runtime environment was development or test, which meant
         * the form nobody verified was the one production ships and the form
         * everybody verified was one no partner ever sees.
         */}
        <Input label="Custom domain" name="domain" required />
        <Input
          label="DNS verification token"
          name="verificationToken"
          required
        />
        <Input label="Brand name" name="brandName" required />
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
        <RecordIdentifier
          label="Exception case ID"
          name="caseId"
          resolved={context.caseId}
          required
        />
        <Select
          label="Decision"
          name="decision"
          defaultValue="approved"
          onChange={(event) => onDecisionChange?.(event.target.value)}
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
        <RecordIdentifier
          label="Billing account ID"
          name="accountId"
          resolved={context.accountId}
          required
        />
        <RecordIdentifier
          label="Invoice ID"
          name="invoiceId"
          resolved={context.invoiceId}
          required
        />
        <RecordIdentifier
          label="Payment ID"
          name="paymentId"
          resolved={context.paymentId}
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
          required
        />
        {/*
         * The one field on this form that is not a record identity and not the
         * reader's answer either. `expectedVersion` is compared against the
         * account aggregate's own `row_version`, which arrives with an
         * authoritative read of the account -- the same read that would supply
         * the current legal name and billing contact this form leaves blank.
         * No surface performs that read, so there is no version to carry and
         * `WorkflowRecordContext` deliberately has no key for one: a route
         * could only offer the projection row's version, which is a different
         * counter and would be a wrong number under a right name. Until the
         * read exists this stays a visible, labelled guess that the server
         * rejects when it is stale, which is the failure the reader can act on.
         */}
        <Input
          label="Current row version"
          name="rowVersion"
          type="number"
          min="1"
          defaultValue="1"
          required
          help="No surface reads the account's current row version yet, so this is a guess the server will reject if the account has moved on."
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
        <RecordIdentifier
          label="Organization ID"
          name="organizationId"
          resolved={context.organizationId}
          required
        />
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
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
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
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

/**
 * A report is scoped to one account or to none. Where the route opened an
 * account, that is the account the report is about, so it is carried rather
 * than typed; a route that opened nothing leaves the filter free.
 */
function reportFields(context: WorkflowRecordContext) {
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
      <RecordIdentifier
        label="Account ID"
        name="accountId"
        resolved={context.accountId}
        optionalLabel="Optional"
      />
    </>
  );
}

export function WorkflowPanel({
  workflow,
  surface,
  context,
}: {
  workflow: SurfaceWorkflow;
  surface: SurfaceKey;
  /**
   * Identifiers the mounting route has already resolved.
   *
   * Required, and deliberately not defaulted. It was optional, and an optional
   * prop is a declaration that nothing enforces: five routes passed one, four
   * did not, and the four that did not rendered forms whose Submit posted
   * nothing. Making it required moves that from something a reviewer has to
   * notice to something the build refuses -- every current and future mount
   * either states what it resolved or does not compile. A surface that binds no
   * record identity at all says so with an explicit `{}`.
   */
  context: WorkflowRecordContext;
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
  const [decision, setDecision] = useState(defaultDecision(workflow));
  /** Bumped on confirmation so the uncontrolled dialog returns to its closed state. */
  const [confirmations, setConfirmations] = useState(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  /**
   * The fields are built before the rest of the panel so their own `required`
   * flags can answer whether this surface can bind the action at all, without
   * a second list of per-workflow identifiers that could disagree with them.
   */
  const fields =
    workflow === "reports"
      ? reportFields(context)
      : mutationFields({
          workflow,
          surface,
          context,
          activeAgreementTemplate,
          onDecisionChange: setDecision,
        });
  const missingIdentifiers = unresolvedIdentifiers(fields);
  const unbindable = missingIdentifiers.length > 0;

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
    // The submit control is already disabled in this state; the guard is here
    // because the destructive path re-enters through `requestSubmit`.
    if (unbindable) {
      showError(unbindableMessage(missingIdentifiers));
      return;
    }
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
      /*
       * An `unavailable` command used to be reported as "Development
       * simulation accepted. No production record was created." whenever the
       * runtime environment was development or test. That is a success message
       * for a request that failed, on a surface that posts real commands, and
       * it is removed rather than inherited.
       *
       * Three reasons, in order of weight. It made every local and CI drive of
       * this panel unable to tell a working command from an unreachable API,
       * which is exactly the confusion this work-stream keeps finding. Its
       * gate read `NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV ?? NODE_ENV`, a public
       * value inlined at build time, so one mis-set build variable turns a
       * failed production command into a green tick. And a reader has no way
       * to know the sentence is about the environment rather than the record.
       * A failed command now says it failed, in development as in production.
       */
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
        caught instanceof Error ? caught.message : "The export failed.",
      );
    } finally {
      setPending(false);
    }
  };

  const destructive = decisionIsDestructive(workflow, decision);
  const submitControl = (
    <Button
      type={destructive ? "button" : "submit"}
      {...(destructive ? { variant: "danger" as const } : {})}
      disabled={
        pending ||
        unbindable ||
        (workflow === "agreement" && !activeAgreementTemplate)
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
  );

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
        ref={formRef}
        onSubmit={(event) => {
          void run(event);
        }}
        noValidate
      >
        {fields}
        {unbindable ? (
          <p className="form-message form-message--error">
            {unbindableMessage(missingIdentifiers)}
          </p>
        ) : null}
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
              className={buttonClassName({ variant: "primary" })}
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
          {destructive ? (
            <Dialog
              key={confirmations}
              title={t("workflow.confirm.title")}
              description={t("workflow.confirm.description")}
              closeLabel={t("workflow.confirm.cancel")}
              trigger={submitControl}
              footer={
                <Button
                  variant="danger"
                  onClick={() => {
                    setConfirmations((count) => count + 1);
                    formRef.current?.requestSubmit();
                  }}
                >
                  {t("workflow.confirm.action")}
                </Button>
              }
            >
              <p>{t("workflow.confirm.detail")}</p>
            </Dialog>
          ) : (
            submitControl
          )}
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
              // The reset restores each select to its default, so the tracked
              // decision has to follow or the confirmation step goes stale.
              setDecision(defaultDecision(workflow));
            }}
          >
            Clear
          </Button>
        </div>
      </form>
    </section>
  );
}
