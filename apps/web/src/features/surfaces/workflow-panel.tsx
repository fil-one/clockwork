"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { useRouter } from "next/navigation";
import { isValidElement, useRef, useState, type ReactNode } from "react";

import { uuidV7 } from "@clockwork/contracts";
import { Button, Dialog, Input, Select, Textarea } from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";
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
import { commerceErrorText } from "@/src/features/contracts/error-text";

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

const titles: Record<SurfaceWorkflow, MessageId> = {
  poc: "platform.workflow.title.poc",
  renewal: "platform.workflow.title.renewal",
  reports: "platform.workflow.title.reports",
  account: "platform.workflow.title.account",
  invite: "platform.workflow.title.invite",
  procurement: "platform.workflow.title.procurement",
  agreementAdmin: "platform.workflow.title.agreementAdmin",
  brand: "platform.workflow.title.brand",
  approval: "platform.workflow.title.approval",
};

/** The contract's closed set of report names, each with its reader-facing name. */
const reportLabels: Record<ReportName, MessageId> = {
  revenue_forecast: "platform.workflow.report.revenueForecast",
  capacity_planning: "platform.workflow.report.capacityPlanning",
  renewal_churn_exposure: "platform.workflow.report.renewalChurnExposure",
  partner_performance: "platform.workflow.report.partnerPerformance",
  funnel_cycle_time: "platform.workflow.report.funnelCycleTime",
  margin_poc_cost: "platform.workflow.report.marginPocCost",
  arr_mrr: "platform.workflow.report.arrMrr",
  billing_collections: "platform.workflow.report.billingCollections",
  commission_settlement: "platform.workflow.report.commissionSettlement",
  three_way_tie_out: "platform.workflow.report.threeWayTieOut",
  weekly_scorecard: "platform.workflow.report.weeklyScorecard",
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
  const t = useTranslations();
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
        help={
          help
            ? t("common.join.sentences", {
                first: help,
                second: t("platform.workflow.resolvedHelp"),
              })
            : t("platform.workflow.resolvedHelp")
        }
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
        error={t("platform.workflow.identifierUnavailable")}
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

/**
 * One sentence naming every identifier the surface is missing. The labels are
 * listed as the fields show them and joined by the reader's own list format,
 * so no language inherits English casing or an English "and".
 */
function unbindableMessage(
  identifiers: readonly { label: string }[],
  t: Translator,
  locale: string,
): string {
  const fields = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    identifiers.map(({ label }) => label),
  );
  return t("platform.workflow.unbindable", { fields });
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
  t,
}: {
  workflow: SurfaceWorkflow;
  surface: SurfaceKey;
  context: WorkflowRecordContext;
  onDecisionChange?: ((decision: string) => void) | undefined;
  t: Translator;
}): ReactNode {
  if (workflow === "poc")
    return (
      <>
        <Select
          label={t("platform.workflow.poc.action")}
          name="pocAction"
          defaultValue="request"
          options={[
            {
              value: "request",
              label: t("platform.workflow.poc.action.request"),
            },
            {
              value: "convert",
              label: t("platform.workflow.poc.action.convert"),
            },
          ]}
        />
        <RecordIdentifier
          label={t("platform.workflow.field.accountId")}
          name="accountId"
          resolved={
            surface === "sandboxes"
              ? context.endClientAccountId
              : context.accountId
          }
          required
        />
        <RecordIdentifier
          label={t("platform.workflow.field.partnerAccountId")}
          name="partnerAccountId"
          resolved={
            surface === "sandboxes" ? context.partnerAccountId : undefined
          }
          optionalLabel={t("common.optional")}
        />
        <RecordIdentifier
          label={t("platform.workflow.poc.pocId")}
          name="pocId"
          resolved={context.pocId}
          help={t("platform.workflow.poc.conversionOnly")}
        />
        <RecordIdentifier
          label={t("platform.workflow.poc.buyerUserId")}
          name="buyerUserId"
          resolved={context.userId}
        />
        <RecordIdentifier
          label={t("platform.workflow.poc.supportOwnerId")}
          name="supportOwnerId"
          resolved={context.supportOwnerId}
        />
        <Input
          label={t("platform.workflow.poc.workload")}
          name="workload"
          defaultValue={t("platform.workflow.poc.workload.default")}
        />
        <Select
          label={t("platform.workflow.poc.dataClass")}
          name="permittedDataClass"
          defaultValue="confidential"
          options={[
            {
              value: "synthetic",
              label: t("platform.workflow.poc.dataClass.synthetic"),
            },
            {
              value: "public",
              label: t("platform.workflow.poc.dataClass.public"),
            },
            {
              value: "confidential",
              label: t("platform.workflow.poc.dataClass.confidential"),
            },
            {
              value: "regulated",
              label: t("platform.workflow.poc.dataClass.regulated"),
            },
          ]}
        />
        <Input
          label={t("platform.workflow.poc.successTest")}
          name="successTest"
          defaultValue={t("platform.workflow.poc.successTest.default")}
        />
        <Input
          label={t("platform.workflow.poc.successTarget")}
          name="successTarget"
          defaultValue={t("platform.workflow.poc.successTarget.default")}
        />
        <Input
          label={t("platform.workflow.poc.capacityCap")}
          name="capacityCap"
          inputMode="decimal"
          defaultValue="10"
        />
        <Input
          label={t("platform.workflow.poc.egressCap")}
          name="egressCap"
          inputMode="decimal"
          defaultValue="2"
        />
        <Input
          label={t("platform.workflow.poc.expiresAt")}
          name="expiresAt"
          type="datetime-local"
          defaultValue="2026-08-31T17:00"
        />
        <RecordIdentifier
          label={t("platform.workflow.poc.paidQuoteId")}
          name="quoteId"
          resolved={context.quoteId}
          help={t("platform.workflow.poc.conversionOnly")}
        />
        <RecordIdentifier
          label={t("platform.workflow.poc.paidOrderId")}
          name="orderId"
          resolved={context.orderId}
          help={t("platform.workflow.poc.conversionOnly")}
        />
      </>
    );

  if (workflow === "renewal")
    return (
      <>
        <Select
          label={t("platform.workflow.renewal.action")}
          name="renewalAction"
          defaultValue="renew"
          onChange={(event) => onDecisionChange?.(event.target.value)}
          options={[
            {
              value: "renew",
              label: t("platform.workflow.renewal.action.renew"),
            },
            {
              value: "change_term",
              label: t("platform.workflow.renewal.action.changeTerm"),
            },
            {
              value: "request_change",
              label: t("platform.workflow.renewal.action.requestChange"),
            },
            {
              value: "decline",
              label: t("platform.workflow.renewal.action.decline"),
            },
          ]}
        />
        <RecordIdentifier
          label={t("platform.workflow.field.accountId")}
          name="accountId"
          resolved={context.accountId}
          required
        />
        <RecordIdentifier
          label={t("platform.workflow.field.orderId")}
          name="orderId"
          resolved={context.orderId}
          required
        />
        <Input
          label={t("platform.workflow.renewal.termMonths")}
          name="requestedTermMonths"
          type="number"
          defaultValue="12"
          min="1"
        />
        <Textarea
          label={t("platform.workflow.renewal.reason")}
          name="reason"
          defaultValue={t("platform.workflow.renewal.reason.default")}
          help={t("platform.workflow.renewal.declineOnly")}
        />
        <Input
          label={t("platform.workflow.renewal.authorityTitle")}
          name="authorityTitle"
          defaultValue={t("platform.workflow.renewal.authorityTitle.default")}
        />
        <Input
          label={t("platform.workflow.renewal.evidenceDocumentId")}
          name="evidenceDocumentId"
          help={t("platform.workflow.renewal.evidenceHelp")}
        />
        <label className="checkbox-field">
          <input type="checkbox" name="authority" required />
          <span>{t("platform.workflow.renewal.attestation")}</span>
        </label>
      </>
    );

  if (workflow === "brand")
    return (
      <>
        <RecordIdentifier
          label={t("platform.workflow.field.partnerAccountId")}
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
        <Input
          label={t("platform.workflow.brand.domain")}
          name="domain"
          required
        />
        <Input
          label={t("platform.workflow.brand.verificationToken")}
          name="verificationToken"
          required
        />
        <Input
          label={t("platform.workflow.brand.brandName")}
          name="brandName"
          required
        />
        <Input
          label={t("platform.workflow.brand.logoUrl")}
          name="logoUrl"
          type="url"
          optionalLabel={t("common.optional")}
        />
        <Input
          label={t("platform.workflow.brand.primaryColor")}
          name="primaryColor"
          type="color"
          defaultValue="#3157d5"
          required
        />
        <Select
          label={t("platform.workflow.brand.communicationOwner")}
          name="communicationOwner"
          defaultValue="partner"
          options={[
            {
              value: "partner",
              label: t("platform.workflow.brand.communicationOwner.partner"),
            },
            { value: "fil_one", label: t("app.name") },
          ]}
        />
      </>
    );

  if (workflow === "approval")
    return (
      <>
        <RecordIdentifier
          label={t("platform.workflow.approval.caseId")}
          name="caseId"
          resolved={context.caseId}
          required
        />
        <Select
          label={t("platform.workflow.approval.decision")}
          name="decision"
          defaultValue="approved"
          onChange={(event) => onDecisionChange?.(event.target.value)}
          options={[
            {
              value: "approved",
              label: t("platform.workflow.approval.decision.approve"),
            },
            {
              value: "rejected",
              label: t("platform.workflow.approval.decision.reject"),
            },
          ]}
        />
        <Textarea
          label={t("platform.workflow.approval.reason")}
          name="reason"
          minLength={8}
          required
        />
        <Input
          label={t("platform.workflow.field.evidenceDocumentId")}
          name="evidenceDocumentId"
          required
        />
      </>
    );

  if (workflow === "account")
    return (
      <>
        <RecordIdentifier
          label={t("platform.workflow.field.accountId")}
          name="accountId"
          resolved={context.accountId}
          required
        />
        <Input
          label={t("platform.workflow.account.legalName")}
          name="legalName"
          required
        />
        <Input
          label={t("platform.workflow.account.invoiceEmail")}
          name="invoiceDeliveryEmail"
          type="email"
          required
        />
        <Input
          label={t("platform.workflow.account.billingContactName")}
          name="billingContactName"
          required
        />
        <Input
          label={t("platform.workflow.account.billingContactEmail")}
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
          label={t("platform.workflow.field.organizationId")}
          name="organizationId"
          resolved={context.organizationId}
          required
        />
        <RecordIdentifier
          label={t("platform.workflow.field.accountId")}
          name="accountId"
          resolved={context.accountId}
          required
        />
        <Input
          label={t("platform.workflow.invite.email")}
          name="email"
          type="email"
          required
        />
        <Select
          label={t("platform.workflow.invite.role")}
          name="role"
          defaultValue="member"
          options={[
            { value: "owner", label: t("role.owner") },
            { value: "admin", label: t("role.admin") },
            { value: "billing", label: t("role.billing") },
            { value: "member", label: t("role.member") },
          ]}
        />
        <Input
          label={t("platform.workflow.invite.expiresAt")}
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
          label={t("platform.workflow.field.accountId")}
          name="accountId"
          resolved={context.accountId}
          required
        />
        <Input
          label={t("platform.workflow.procurement.apName")}
          name="apName"
          required
        />
        <Input
          label={t("platform.workflow.procurement.apEmail")}
          name="apEmail"
          type="email"
          required
        />
        <Input
          label={t("platform.workflow.account.invoiceEmail")}
          name="invoiceDeliveryEmail"
          type="email"
          required
        />
        <label className="checkbox-field">
          <input type="checkbox" name="poRequired" />
          <span>{t("platform.workflow.procurement.poRequired")}</span>
        </label>
      </>
    );

  if (workflow === "agreementAdmin")
    return (
      <>
        <Input
          label={t("platform.workflow.agreement.type")}
          name="agreementType"
          defaultValue="csa"
          required
        />
        <Input
          label={t("platform.workflow.agreement.semanticVersion")}
          name="semanticVersion"
          defaultValue="1.0.0"
          required
        />
        <Input
          label={t("platform.workflow.agreement.jurisdiction")}
          name="jurisdiction"
          defaultValue="US"
          required
        />
        <Input
          label={t("platform.workflow.agreement.effectiveOn")}
          name="effectiveOn"
          type="date"
          required
        />
        <Input
          label={t("platform.workflow.agreement.canonicalDocumentId")}
          name="canonicalDocumentId"
          required
        />
        <Textarea
          label={t("platform.workflow.agreement.exactText")}
          name="exactText"
          required
        />
        <Select
          label={t("platform.workflow.agreement.executionMode")}
          name="executionMode"
          defaultValue="click_through"
          options={[
            {
              value: "click_through",
              label: t(
                "platform.workflow.agreement.executionMode.clickThrough",
              ),
            },
            {
              value: "counter_signed",
              label: t(
                "platform.workflow.agreement.executionMode.counterSigned",
              ),
            },
          ]}
        />
        <Input
          label={t("platform.workflow.agreement.approvalEvidenceDocumentId")}
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
function reportFields(context: WorkflowRecordContext, t: Translator) {
  return (
    <>
      <Select
        label={t("platform.workflow.report")}
        name="report"
        defaultValue={reportNames[0]}
        options={reportNames.map((report) => ({
          value: report,
          label: t(reportLabels[report]),
        }))}
      />
      <RecordIdentifier
        label={t("platform.workflow.field.accountId")}
        name="accountId"
        resolved={context.accountId}
        optionalLabel={t("common.optional")}
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
  const locale = useFormattingLocale();
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
      ? reportFields(context, t)
      : mutationFields({
          workflow,
          surface,
          context,
          onDecisionChange: setDecision,
          t,
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
      showError(unbindableMessage(missingIdentifiers, t, locale));
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
        setSuccess(t("platform.workflow.success.account"));
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
        // Never shown: the catch below words every failure for the reader.
        throw new Error(
          `No command is wired for the ${String(unhandled)} workflow, so nothing was sent.`, // i18n-exempt: developer invariant; the catch shows commerceErrorText, never this message
        );
      }
      if (workflow !== "account") {
        setSuccess(
          t(
            workflow === "reports"
              ? "platform.workflow.success.report"
              : workflow === "brand"
                ? "platform.workflow.success.brand"
                : workflow === "renewal" && surface === "partnerRenewals"
                  ? "platform.workflow.success.partnerRenewal"
                  : "platform.workflow.success.request",
          ),
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
      showError(commerceErrorText(caught, t));
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
      setSuccess(t("platform.workflow.success.csv"));
    } catch (caught) {
      showError(commerceErrorText(caught, t));
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
      {t(
        workflow === "reports"
          ? "platform.workflow.viewReport"
          : "common.submit",
      )}
    </Button>
  );

  return (
    <section
      className="workflow-panel"
      aria-labelledby={`workflow-title-${surface}`}
    >
      <div>
        <p className="eyebrow">{t("platform.workflow.eyebrow")}</p>
        <h2 id={`workflow-title-${surface}`}>{t(titles[workflow])}</h2>
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
            {unbindableMessage(missingIdentifiers, t, locale)}
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
            {t("platform.workflow.submitting")}
          </p>
        ) : null}
        {success ? (
          <p className="form-message form-message--success" role="status">
            {success}
          </p>
        ) : null}
        {reportResult ? (
          <pre
            className="form-message"
            aria-label={t("platform.workflow.reportResult")}
          >
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
                  setError(t("platform.workflow.reportFormUnavailable"));
                  return;
                }
                void download(form);
              }}
            >
              {t("platform.workflow.downloadCsv")}
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
            {t("common.clear")}
          </Button>
        </div>
      </form>
    </section>
  );
}
