"use client";
import { useTranslations } from "@/src/i18n/client";

import { useRouter } from "next/navigation";
import { isValidElement, useRef, useState, type ReactNode } from "react";

import { uuidV7 } from "@clockwork/contracts";
import { Button, Dialog, Input, Select, Textarea } from "@clockwork/ui";

import {
  convertPoc,
  decideException,
  declineRenewal,
  downloadReportCsv,
  inviteOrganizationMember,
  publishAgreementTemplate,
  readCoreAccount,
  readReport,
  registerPartnerDomain,
  reportNames,
  requestPoc,
  requestRenewal,
  sendCoreCommand,
  updateProcurementProfile,
  type ReportName,
} from "@/src/features/contracts/commerce-client";

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
 * a declaration standing in for an implementation, so it does not belong.
 * `priceBookId` and `agreementId` left with the `quote` and `order` branches
 * that were their only readers: the two record-bound surfaces that took those
 * writes over resolve a price book from an offer and an agreement from the
 * account's own executed agreements, so neither identifier is a route's to hand
 * this panel any more. `invoiceId` and `paymentId` left with the `collections`
 * branch for the same reason -- no route ever set them, and
 * `/internal/collections` now binds a correction to the invoice row the
 * operator clicked. The same test applies from the other side: `rowVersion`
 * used to sit in this
 * interface and was removed, because it is not a record identity at all. It is
 * an optimistic-concurrency token compared against the *core aggregate's*
 * `row_version` (`database-finance.ts`, `input.expectedVersion !==
 * prior.rowVersion`), which is a different counter from the
 * `experience_projections.row_version` a route can reach. The version has to
 * arrive from an authoritative account read. The submit path performs that
 * read immediately before the update, so a reader never has to see or guess
 * the concurrency token and a stale write still fails closed.
 */
export interface WorkflowRecordContext {
  accountId?: string;
  organizationId?: string;
  partnerAccountId?: string;
  endClientAccountId?: string;
  userId?: string;
  supportOwnerId?: string;
  quoteId?: string;
  orderId?: string;
  pocId?: string;
  caseId?: string;
}

const titles: Record<SurfaceWorkflow, string> = {
  poc: "Request or convert a proof of concept",
  renewal: "Renew or decline renewal",
  reports: "Run a traceable report",
  account: "Account update",
  invite: "Invite an organization member",
  procurement: "Update procurement readiness",
  agreementAdmin: "Publish an approved agreement template",
  brand: "Brand and custom domain",
  approval: "Administrative approval",
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
  if (workflow === "renewal") return decision === "decline";
  if (workflow === "approval") return decision === "rejected";
  return false;
}

function mutationFields({
  workflow,
  surface,
  context,
  onDecisionChange,
}: {
  workflow: SurfaceWorkflow;
  surface: SurfaceKey;
  context: WorkflowRecordContext;
  onDecisionChange?: ((decision: string) => void) | undefined;
}): ReactNode {
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

  if (workflow === "account")
    return (
      <>
        <RecordIdentifier
          label="Account ID"
          name="accountId"
          resolved={context.accountId}
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
  const t = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [reportResult, setReportResult] = useState<unknown>(null);
  const [decision, setDecision] = useState(defaultDecision(workflow));
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const submittingRef = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const commandKeyRef = useRef<string | null>(null);

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
          onDecisionChange: setDecision,
        });
  const missingIdentifiers = unresolvedIdentifiers(fields);
  const unbindable = missingIdentifiers.length > 0;

  const showError = (message: string) => {
    setError(message);
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  const run = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const form = event.currentTarget;
    setError("");
    setSuccess("");
    setReportResult(null);
    // The submit control is already disabled in this state; the guard is here
    // because the destructive path re-enters through `requestSubmit`.
    if (unbindable) {
      showError(unbindableMessage(missingIdentifiers));
      return;
    }
    if (!form.checkValidity()) {
      setConfirmationOpen(false);
      form.reportValidity();
      window.setTimeout(
        () => form.querySelector<HTMLElement>(":invalid")?.focus(),
        0,
      );
      return;
    }
    const data = new FormData(form);

    submittingRef.current = true;
    setPending(true);
    try {
      let result: unknown;
      if (workflow === "poc") {
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
      } else if (workflow === "account") {
        commandKeyRef.current ??= crypto.randomUUID();
        const accountId = value(data, "accountId");
        const current = await readCoreAccount(accountId);
        await sendCoreCommand(
          {
            resource: "accounts",
            id: accountId,
            accountId,
            action: "update",
            expectedVersion: current.rowVersion,
            payload: {
              legalName: value(data, "legalName"),
              invoiceDeliveryEmail: value(data, "invoiceDeliveryEmail"),
              billingContact: {
                name: value(data, "billingContactName"),
                email: value(data, "billingContactEmail"),
              },
            },
          },
          { idempotencyKey: commandKeyRef.current },
        );
        commandKeyRef.current = null;
        setSuccess("Account settings saved.");
        router.refresh();
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
      } else {
        /*
         * Unreachable while this chain and `SurfaceWorkflow` agree, which is
         * exactly what it is here to keep true. `admin` was a member of that
         * union with no fields branch and no command branch: the panel rendered
         * an empty form, Submit fell through every arm, and the success message
         * below announced "the server record is now the source of truth" having
         * sent nothing at all. `workflow` narrows to `never` here, so a member
         * added without a command now fails the build instead of shipping that
         * again.
         */
        const unhandled: never = workflow;
        throw new Error(
          `No command is wired for the ${String(unhandled)} workflow, so nothing was sent.`,
        );
      }
      if (workflow !== "account") {
        setSuccess(
          workflow === "reports"
            ? "Report loaded from source records."
            : workflow === "brand"
              ? "Brand settings saved. DNS verification is pending at your provider."
              : workflow === "renewal" && surface === "partnerRenewals"
                ? "Renewal decision saved. The portfolio record now shows the pending outcome."
                : "Request accepted. The server record is now the source of truth.",
        );
        if (workflow !== "reports") router.refresh();
      }
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
      submittingRef.current = false;
      setPending(false);
      setConfirmationOpen(false);
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
      disabled={pending || unbindable}
    >
      {workflow === "reports" ? "View report" : "Submit securely"}
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
        {reportResult ? (
          <pre className="form-message" aria-label="Report result">
            {JSON.stringify(reportResult, null, 2)}
          </pre>
        ) : null}
        <div className="form-actions">
          {destructive ? (
            <Dialog
              open={confirmationOpen}
              onOpenChange={setConfirmationOpen}
              title={t("workflow.confirm.title")}
              description={t("workflow.confirm.description")}
              closeLabel={t("workflow.confirm.cancel")}
              trigger={submitControl}
              footer={
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
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
              commandKeyRef.current = null;
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
