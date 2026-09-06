import {
  IdempotencyKeySchema,
  MoneySchema,
  type ProviderFailureKind,
} from "@clockwork/contracts";
import {
  assessExemptionCertificate,
  EXPIRED_EXEMPTION_BLOCKS_INVOICING,
} from "@clockwork/domain/core";
import { commissionLineBindingHash } from "@clockwork/integrations/core";

import { workflowIdempotencyKey } from "../policy";
import { renderCsv } from "./csv";
import {
  absolute,
  downstreamIdempotencyKey,
  formatDecimal,
  parseDecimal,
  payloadHash,
  sha256,
} from "./determinism";
import type {
  CoreWorkflowDependencies,
  CoreCapabilityKey,
  CoreWorkflowRecord,
  CoreWorkflowTaskId,
  ExceptionQueue,
  ReportRow,
  WorkflowExceptionRequest,
} from "./ports";
import {
  CertificateExpiryInputSchema,
  DunningInputSchema,
  ExportReportInputSchema,
  IssueInvoiceInputSchema,
  PartnerCreditInputSchema,
  ReconcileUsageInputSchema,
  SettleCommissionsInputSchema,
  SyncOverageInputSchema,
  ThreeWayReconciliationInputSchema,
  type CertificateExpiryInput,
  type CoreWorkflowContext,
  type DunningInput,
  type PartnerCreditInput,
} from "./schemas";

export type WorkflowExecution<T> =
  | {
      status: "completed";
      invocationKey: string;
      duplicate: boolean;
      value: T;
    }
  | { status: "in_progress"; invocationKey: string }
  | {
      status: "permanent_failure";
      invocationKey: string;
      duplicate: boolean;
      code: string;
      safeDetail: string;
      exceptionCaseId: string;
    };

export class TransientWorkflowError extends Error {
  public override readonly name = "TransientWorkflowError";

  public constructor(
    public readonly code: string,
    public readonly retryAfterMs?: number,
  ) {
    super("A transient workflow dependency failed; the run is safe to retry");
  }
}

export class WorkflowPayloadError extends Error {
  public override readonly name = "WorkflowPayloadError";
  public readonly code = "INVALID_WORKFLOW_PAYLOAD";

  public constructor() {
    super(
      "The workflow payload is invalid and must be corrected before replay",
    );
  }
}

const coreCapabilityRequirements: Readonly<
  Record<
    CoreWorkflowTaskId,
    { capabilities: readonly CoreCapabilityKey[]; recovery: boolean }
  >
> = {
  "core.billing.issue-invoice.v1": {
    capabilities: ["billing"],
    recovery: false,
  },
  "core.billing.sync-overage.v1": {
    capabilities: ["billing"],
    recovery: true,
  },
  "core.collections.dunning.v1": {
    capabilities: ["billing"],
    recovery: true,
  },
  "core.collections.partner-credit.v1": {
    capabilities: ["new_business", "partner"],
    recovery: false,
  },
  "core.commissions.settle.v1": {
    capabilities: ["billing", "partner"],
    recovery: true,
  },
  "core.procurement.certificate-expiry.v1": {
    capabilities: ["billing"],
    recovery: true,
  },
  "core.reconciliation.usage.v1": {
    capabilities: ["billing"],
    recovery: true,
  },
  "core.reconciliation.three-way.v1": {
    capabilities: ["billing"],
    recovery: true,
  },
  "core.reporting.export.v1": {
    capabilities: ["billing"],
    recovery: true,
  },
};

type PermanentFailure = Extract<
  WorkflowExecution<never>,
  { status: "permanent_failure" }
>;

type WorkResult<T> =
  | { kind: "success"; value: T }
  | {
      kind: "permanent_failure";
      code: string;
      safeDetail: string;
      exceptionCaseId: string;
    };

type ProviderFailure = {
  ok: false;
  kind: ProviderFailureKind;
  code: string;
  message: string;
  retryAfterMs?: number;
};

const TASKS = {
  issueInvoice: "core.billing.issue-invoice.v1",
  syncOverage: "core.billing.sync-overage.v1",
  dunning: "core.collections.dunning.v1",
  partnerCredit: "core.collections.partner-credit.v1",
  settleCommissions: "core.commissions.settle.v1",
  certificateExpiry: "core.procurement.certificate-expiry.v1",
  reconcileUsage: "core.reconciliation.usage.v1",
  threeWay: "core.reconciliation.three-way.v1",
  exportReport: "core.reporting.export.v1",
} as const satisfies Record<string, CoreWorkflowTaskId>;

function businessPayload<T extends { context: CoreWorkflowContext }>(
  input: T,
): Omit<T, "context"> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== "context"),
  ) as Omit<T, "context">;
}

function assertAggregate(
  actual: string,
  expected: string,
  label: string,
): void {
  if (actual !== expected)
    throw new Error(`Workflow aggregate must be the ${label} identifier`);
}

function invocationKey(
  taskId: CoreWorkflowTaskId,
  aggregateType: string,
  context: CoreWorkflowContext,
) {
  return IdempotencyKeySchema.parse(
    workflowIdempotencyKey({
      aggregateType,
      aggregateId: context.aggregateId,
      aggregateVersion: context.aggregateVersion,
      operation: taskId,
      payload: {},
    }),
  );
}

function safeProviderDetail(operation: string, code: string): string {
  return `${operation} was rejected by the provider (code ${code}); review the owned exception before replaying.`;
}

function parsePayload<T>(
  parser: { parse(value: unknown): T },
  raw: unknown,
): T {
  try {
    return parser.parse(raw);
  } catch {
    throw new WorkflowPayloadError();
  }
}

export interface DunningDecision {
  stage: "current" | "first_threshold" | "second_threshold";
  pauseNewCommerce: boolean;
  writeSuspensionRequiresReview: boolean;
  deletionPermitted: false;
  retentionBlockedUntil: string | null;
}

export function decideDunning(input: DunningInput): DunningDecision {
  const paid =
    input.invoiceStatus === "paid" ||
    (input.outstanding !== undefined &&
      input.outstanding !== null &&
      BigInt(input.outstanding.minor) <= 0n);
  const secondStage =
    !paid &&
    (input.invoiceStatus === "uncollectible" ||
      input.daysPastDue >= input.secondThresholdDays);
  const firstStage = !paid && input.daysPastDue >= input.firstThresholdDays;
  const activeRetention =
    input.maxRetentionUntil !== null &&
    Date.parse(input.maxRetentionUntil) > Date.parse(input.context.occurredAt);

  if (secondStage) {
    return {
      stage: "second_threshold",
      pauseNewCommerce: true,
      writeSuspensionRequiresReview: input.serviceRunning,
      deletionPermitted: false,
      retentionBlockedUntil: activeRetention ? input.maxRetentionUntil : null,
    };
  }
  if (firstStage) {
    return {
      stage: "first_threshold",
      pauseNewCommerce: true,
      writeSuspensionRequiresReview: false,
      deletionPermitted: false,
      retentionBlockedUntil: activeRetention ? input.maxRetentionUntil : null,
    };
  }
  return {
    stage: "current",
    pauseNewCommerce: false,
    writeSuspensionRequiresReview: false,
    deletionPermitted: false,
    retentionBlockedUntil: activeRetention ? input.maxRetentionUntil : null,
  };
}

export interface CertificateFollowUpTask {
  kind: "collect_exemption_certificate";
  jurisdiction: string;
  documentId: string;
  dueAt: string;
}

export interface CertificateExpiryDecision {
  stage: "clear" | "notice" | "lapsed";
  expiringCount: number;
  expiredCount: number;
  blocksInvoicing: boolean;
  tasks: readonly CertificateFollowUpTask[];
}

/**
 * Re-reads each certificate against the sweep's as-of date. A lapsed
 * certificate raises a follow-up due immediately; one inside the notice window
 * is due on its expiry date. Both are flags: invoicing is not withheld, which
 * is EXT-TAX-01's decision to change, not this step's.
 */
export function decideCertificateExpiry(
  input: CertificateExpiryInput,
): CertificateExpiryDecision {
  const assessments = input.certificates.map((certificate) => ({
    certificate,
    assessment: assessExemptionCertificate(
      {
        jurisdiction: certificate.jurisdiction,
        certificateDocumentId: certificate.documentId,
        expiresOn: certificate.expiresOn,
      },
      input.asOfDate,
      input.noticeWindowDays,
    ),
  }));
  const expired = assessments.filter(
    (item) => item.assessment.status === "expired",
  );
  const expiring = assessments.filter(
    (item) => item.assessment.status === "expiring",
  );
  return {
    stage:
      expired.length > 0 ? "lapsed" : expiring.length > 0 ? "notice" : "clear",
    expiringCount: expiring.length,
    expiredCount: expired.length,
    blocksInvoicing: expired.length > 0 && EXPIRED_EXEMPTION_BLOCKS_INVOICING,
    tasks: [...expired, ...expiring].map(
      ({ certificate, assessment }): CertificateFollowUpTask => ({
        kind: "collect_exemption_certificate",
        jurisdiction: certificate.jurisdiction,
        documentId: certificate.documentId,
        dueAt:
          assessment.status === "expired"
            ? input.asOfDate
            : (certificate.expiresOn ?? input.asOfDate),
      }),
    ),
  };
}

export interface PartnerCreditDecision {
  allowNewService: boolean;
  projectedExposureMinor: string;
  reason:
    | "within_policy"
    | "running_service_never_blocked"
    | "payment_history_required"
    | "aggregate_credit_limit_exceeded";
}

export function decidePartnerCredit(
  input: PartnerCreditInput,
): PartnerCreditDecision {
  const projected =
    BigInt(input.currentExposureMinor) + BigInt(input.requestedExposureMinor);
  if (input.serviceKind === "running_service") {
    return {
      allowNewService: true,
      projectedExposureMinor: projected.toString(),
      reason: "running_service_never_blocked",
    };
  }
  if (input.creditPolicy === "net_terms" && !input.hasRequiredPaymentHistory) {
    return {
      allowNewService: false,
      projectedExposureMinor: projected.toString(),
      reason: "payment_history_required",
    };
  }
  if (projected > BigInt(input.creditLimitMinor)) {
    return {
      allowNewService: false,
      projectedExposureMinor: projected.toString(),
      reason: "aggregate_credit_limit_exceeded",
    };
  }
  return {
    allowNewService: true,
    projectedExposureMinor: projected.toString(),
    reason: "within_policy",
  };
}

export class CoreFinanceWorkflowEngine {
  public constructor(private readonly dependencies: CoreWorkflowDependencies) {}

  public async issueInvoice(raw: unknown): Promise<
    WorkflowExecution<{
      providerInvoiceId: string;
      providerStatus: string;
      accountingPostingId?: string;
    }>
  > {
    const input = parsePayload(IssueInvoiceInputSchema, raw);
    assertAggregate(input.context.aggregateId, input.invoiceId, "invoice");
    const source = input.paygSource
      ? { paygSource: input.paygSource }
      : input.orderId
        ? { orderId: input.orderId }
        : undefined;
    if (!source) throw new Error("INVOICE_SOURCE_REQUIRED");
    return this.runControlled(
      TASKS.issueInvoice,
      "invoice",
      input,
      async (key) => {
        const issued = await this.dependencies.billing.issueInvoice({
          invoiceId: input.invoiceId,
          customerId: input.customerId,
          ...source,
          amount: input.amount,
          ...(input.poNumber === undefined ? {} : { poNumber: input.poNumber }),
          idempotencyKey: downstreamIdempotencyKey(key, "billing-issue"),
        });
        if (!issued.ok)
          return this.providerFailure(
            input.context,
            key,
            TASKS.issueInvoice,
            "billing_operations",
            "Billing invoice issuance",
            issued,
          );

        let accountingPostingId: string | undefined;
        if (input.collectionMethod === "net_terms") {
          const posted = await this.dependencies.accounting.postInvoice({
            invoiceId: input.invoiceId,
            mode: "accounts_receivable",
            idempotencyKey: downstreamIdempotencyKey(key, "accounting-ar"),
          });
          if (!posted.ok)
            return this.providerFailure(
              input.context,
              key,
              TASKS.issueInvoice,
              "billing_operations",
              "Accounts-receivable posting",
              posted,
            );
          accountingPostingId = posted.value.postingId;
        }

        const value = {
          providerInvoiceId: issued.value.providerInvoiceId,
          providerStatus: issued.value.status,
          ...(accountingPostingId === undefined ? {} : { accountingPostingId }),
        };
        await this.record(key, input.context, {
          kind: "invoice_issued",
          taskId: TASKS.issueInvoice,
          input,
          ...value,
        });
        return { kind: "success", value };
      },
    );
  }

  public async syncOverage(raw: unknown): Promise<
    WorkflowExecution<{
      providerInvoiceItemIds: readonly string[];
      duplicateSourceUsageIds: readonly string[];
    }>
  > {
    const input = parsePayload(SyncOverageInputSchema, raw);
    assertAggregate(
      input.context.aggregateId,
      input.periodId,
      "commitment period",
    );
    return this.runControlled(
      TASKS.syncOverage,
      "commitment_ledger",
      input,
      async (key) => {
        const synced = await this.dependencies.metering.syncOverage({
          invoiceId: input.invoiceId,
          providerInvoiceId: input.providerInvoiceId,
          orderId: input.orderId,
          customerId: input.customerId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          lines: input.lines,
          idempotencyKey: downstreamIdempotencyKey(key, "metered-overage"),
        });
        if (!synced.ok)
          return this.providerFailure(
            input.context,
            key,
            TASKS.syncOverage,
            "billing_operations",
            "Metered overage synchronization",
            synced,
          );
        const value = {
          providerInvoiceItemIds: synced.value.providerInvoiceItemIds,
          duplicateSourceUsageIds: synced.value.duplicateSourceUsageIds,
        };
        await this.record(key, input.context, {
          kind: "overage_synced",
          taskId: TASKS.syncOverage,
          input,
          ...value,
        });
        return { kind: "success", value };
      },
    );
  }

  public async applyDunning(raw: unknown): Promise<
    WorkflowExecution<{
      decision: DunningDecision & { exceptionCaseId?: string };
      notificationMessageId?: string;
    }>
  > {
    const input = parsePayload(DunningInputSchema, raw);
    assertAggregate(input.context.aggregateId, input.invoiceId, "invoice");
    return this.runControlled(TASKS.dunning, "invoice", input, async (key) => {
      const policyDecision = decideDunning(input);
      let exceptionCaseId: string | undefined;
      if (policyDecision.stage !== "current") {
        const exception = await this.openException({
          taskId: TASKS.dunning,
          context: input.context,
          invocationKey: key,
          queue: "credit_collections",
          code: `DUNNING_${policyDecision.stage.toUpperCase()}`,
          safeDetail:
            policyDecision.stage === "second_threshold"
              ? "The invoice reached the second aging threshold; a human must decide any write suspension and retention obligations prevent automated deletion."
              : "The invoice reached the first aging threshold; new orders and POC conversions are paused pending collections review.",
          severity:
            policyDecision.stage === "second_threshold"
              ? "blocking"
              : "warning",
          metadata: {
            invoiceId: input.invoiceId,
            billingAccountId: input.billingAccountId,
            daysPastDue: input.daysPastDue.toString(),
            collectionsOwner: input.collectionsOwner,
            commercialShape: input.commercialShape,
            ...(policyDecision.retentionBlockedUntil === null
              ? {}
              : {
                  retentionBlockedUntil: policyDecision.retentionBlockedUntil,
                }),
          },
        });
        exceptionCaseId = exception.caseId;
      }

      let notificationMessageId: string | undefined;
      if (policyDecision.stage !== "current") {
        const notification = await this.dependencies.notifications.send({
          template: `collections.${policyDecision.stage}.v1`,
          recipients: [
            ...new Set([input.collectionsOwner, ...input.billingRecipients]),
          ],
          data: {
            invoiceId: input.invoiceId,
            billingAccountId: input.billingAccountId,
            daysPastDue: input.daysPastDue,
            commercialShape: input.commercialShape,
            ...(input.outstanding ? { outstanding: input.outstanding } : {}),
            pauseNewCommerce: policyDecision.pauseNewCommerce,
            writeSuspensionRequiresReview:
              policyDecision.writeSuspensionRequiresReview,
            deletionPermitted: false,
            retentionBlockedUntil: policyDecision.retentionBlockedUntil,
          },
          idempotencyKey: downstreamIdempotencyKey(
            key,
            `notify-${policyDecision.stage}`,
          ),
        });
        if (!notification.ok)
          return this.providerFailure(
            input.context,
            key,
            TASKS.dunning,
            "credit_collections",
            "Collections notification",
            notification,
          );
        notificationMessageId = notification.value.messageId;
      }

      const decision = {
        ...policyDecision,
        ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
      };
      const value = {
        decision,
        ...(notificationMessageId === undefined
          ? {}
          : { notificationMessageId }),
      };
      await this.record(key, input.context, {
        kind: "dunning_decided",
        taskId: TASKS.dunning,
        input,
        decision,
        ...(notificationMessageId === undefined
          ? {}
          : { notificationMessageId }),
      });
      return { kind: "success", value };
    });
  }

  /**
   * Re-evaluates the exemption certificates on one account. Onboarding checks
   * expiry once when the profile is written; this is the recurring check, so a
   * certificate that lapsed months later is raised rather than assumed valid.
   */
  public async assessCertificateExpiry(raw: unknown): Promise<
    WorkflowExecution<{
      decision: CertificateExpiryDecision & { exceptionCaseId?: string };
    }>
  > {
    const input = parsePayload(CertificateExpiryInputSchema, raw);
    assertAggregate(input.context.aggregateId, input.accountId, "account");
    return this.runControlled(
      TASKS.certificateExpiry,
      "account",
      input,
      async (key) => {
        const policyDecision = decideCertificateExpiry(input);
        let exceptionCaseId: string | undefined;
        if (policyDecision.stage !== "clear") {
          const exception = await this.openException({
            taskId: TASKS.certificateExpiry,
            context: input.context,
            invocationKey: key,
            queue: "billing_operations",
            code:
              policyDecision.stage === "lapsed"
                ? "EXEMPTION_CERTIFICATE_EXPIRED"
                : "EXEMPTION_CERTIFICATE_EXPIRING",
            safeDetail:
              policyDecision.stage === "lapsed"
                ? "A tax exemption certificate on this account has passed its expiry date. Invoicing continues; collect a replacement certificate and confirm the exemption still applies."
                : "A tax exemption certificate on this account expires inside the notice window. Collect a replacement before it lapses.",
            severity: "warning",
            metadata: {
              accountId: input.accountId,
              procurementProfileId: input.procurementProfileId,
              asOfDate: input.asOfDate,
              expiredCount: policyDecision.expiredCount.toString(),
              expiringCount: policyDecision.expiringCount.toString(),
              procurementOwner: input.procurementOwner,
              followUpTaskKind: "collect_exemption_certificate",
              jurisdictions: policyDecision.tasks
                .map((task) => task.jurisdiction)
                .join(","),
            },
          });
          exceptionCaseId = exception.caseId;
        }
        const decision = {
          ...policyDecision,
          ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
        };
        await this.record(key, input.context, {
          kind: "certificate_expiry_assessed",
          taskId: TASKS.certificateExpiry,
          input,
          decision,
        });
        return { kind: "success", value: { decision } };
      },
    );
  }

  public async evaluatePartnerCredit(raw: unknown): Promise<
    WorkflowExecution<{
      decision: PartnerCreditDecision & { exceptionCaseId?: string };
    }>
  > {
    const input = parsePayload(PartnerCreditInputSchema, raw);
    assertAggregate(input.context.aggregateId, input.orderId, "order");
    return this.runControlled(
      TASKS.partnerCredit,
      "order",
      input,
      async (key) => {
        const policyDecision = decidePartnerCredit(input);
        let exceptionCaseId: string | undefined;
        if (!policyDecision.allowNewService) {
          const exception = await this.openException({
            taskId: TASKS.partnerCredit,
            context: input.context,
            invocationKey: key,
            queue: "credit_collections",
            code: `PARTNER_CREDIT_${policyDecision.reason.toUpperCase()}`,
            safeDetail:
              "Requested new partner service is blocked pending a credit decision; already-running end-client services remain active.",
            severity: "blocking",
            metadata: {
              orderId: input.orderId,
              partnerAccountId: input.partnerAccountId,
              projectedExposureMinor: policyDecision.projectedExposureMinor,
              creditLimitMinor: input.creditLimitMinor,
              currency: input.currency,
              collectionsOwner: input.collectionsOwner,
            },
          });
          exceptionCaseId = exception.caseId;
        }
        const decision = {
          ...policyDecision,
          ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
        };
        await this.record(key, input.context, {
          kind: "partner_credit_decided",
          taskId: TASKS.partnerCredit,
          input,
          decision,
        });
        return { kind: "success", value: { decision } };
      },
    );
  }

  public async settleCommissions(raw: unknown): Promise<
    WorkflowExecution<{
      payableMinor: string;
      heldMinor: string;
      lineBindingHash: string;
      billId?: string;
    }>
  > {
    const input = parsePayload(SettleCommissionsInputSchema, raw);
    assertAggregate(input.context.aggregateId, input.statementId, "statement");
    return this.runControlled(
      TASKS.settleCommissions,
      "report_export",
      input,
      async (key) => {
        const commission = input.accruals.reduce(
          (sum, accrual) => sum + BigInt(accrual.commissionMinor),
          0n,
        );
        const held = input.accruals.reduce(
          (sum, accrual) => sum + BigInt(accrual.holdbackMinor),
          0n,
        );
        const payable = commission - held;
        if (payable < 0n)
          return this.permanentFailure(
            input.context,
            key,
            TASKS.settleCommissions,
            "commissions",
            "NEGATIVE_COMMISSION_PAYABLE_REQUIRES_CARRY_FORWARD",
            "Commission clawbacks exceed the current statement payable and require an authorized carry-forward before settlement.",
            { statementId: input.statementId },
          );
        const amount = MoneySchema.parse({
          currency: input.currency,
          minor: payable.toString(),
        });
        const accrualIds = input.accruals
          .map((accrual) => accrual.accrualId)
          .sort();
        const lineBindingHash = commissionLineBindingHash({
          statementId: input.statementId,
          partnerAccountId: input.partnerAccountId,
          amount,
          accrualIds,
        });
        let billId: string | undefined;
        const exportKey = downstreamIdempotencyKey(
          key,
          "accounting-commission-bill",
        );
        try {
          await this.dependencies.commissionSettlements.validate({
            statementId: input.statementId,
            partnerAccountId: input.partnerAccountId,
            expectedRowVersion: input.context.aggregateVersion,
            currency: input.currency,
            payableMinor: payable.toString(),
            accrualIds,
            exportKey,
          });
        } catch {
          return this.permanentFailure(
            input.context,
            key,
            TASKS.settleCommissions,
            "commissions",
            "COMMISSION_SETTLEMENT_BINDING_INVALID",
            "The persisted statement, partner, currency, line set, or state did not match the requested settlement.",
            { statementId: input.statementId },
          );
        }
        if (payable > 0n) {
          const posted =
            await this.dependencies.commissionAccounting.postVerifiedCommissionBill(
              {
                statementId: input.statementId,
                partnerAccountId: input.partnerAccountId,
                statementOn: input.periodEnd,
                accrualIds,
                lineBindingHash,
                amount,
                idempotencyKey: exportKey,
              },
            );
          if (!posted.ok)
            return this.providerFailure(
              input.context,
              key,
              TASKS.settleCommissions,
              "commissions",
              "Commission payable posting",
              posted,
            );
          billId = posted.value.billId;
        }
        try {
          await this.dependencies.commissionSettlements.finalize({
            statementId: input.statementId,
            partnerAccountId: input.partnerAccountId,
            expectedRowVersion: input.context.aggregateVersion,
            currency: input.currency,
            payableMinor: payable.toString(),
            accrualIds,
            exportKey,
            ...(billId === undefined ? {} : { providerBillId: billId }),
            requestId: input.context.requestId,
            occurredAt: input.context.occurredAt,
          });
        } catch {
          throw new TransientWorkflowError(
            "COMMISSION_SETTLEMENT_COMMIT_UNAVAILABLE",
          );
        }
        const value = {
          payableMinor: payable.toString(),
          heldMinor: held.toString(),
          lineBindingHash,
          ...(billId === undefined ? {} : { billId }),
        };
        await this.record(key, input.context, {
          kind: "commissions_settled",
          taskId: TASKS.settleCommissions,
          input,
          accrualIds,
          ...value,
        });
        return { kind: "success", value };
      },
    );
  }

  public async reconcileUsage(raw: unknown): Promise<
    WorkflowExecution<{
      variances: readonly {
        sku: string;
        expected: string;
        actual: string;
        difference: string;
      }[];
      missingSourceUsageIds: readonly string[];
      unexpectedSourceUsageIds: readonly string[];
      exceptionCaseId?: string;
    }>
  > {
    const input = parsePayload(ReconcileUsageInputSchema, raw);
    assertAggregate(
      input.context.aggregateId,
      input.ledgerId,
      "commitment ledger",
    );
    return this.runControlled(
      TASKS.reconcileUsage,
      "commitment_ledger",
      input,
      async (key) => {
        const pulled = await this.dependencies.usage.pullUsage({
          organizationId: input.organizationId,
          from: input.from,
          to: input.to,
        });
        if (!pulled.ok)
          return this.providerFailure(
            input.context,
            key,
            TASKS.reconcileUsage,
            "reconciliation",
            "Source usage retrieval",
            pulled,
          );

        const byExternalId = new Map<string, (typeof pulled.value)[number]>();
        const conflictingDuplicateIds = new Set<string>();
        const outOfRangeIds = new Set<string>();
        for (const item of pulled.value) {
          if (
            Date.parse(item.measuredAt) < Date.parse(input.from) ||
            Date.parse(item.measuredAt) >= Date.parse(input.to)
          ) {
            outOfRangeIds.add(item.externalId);
            continue;
          }
          const existing = byExternalId.get(item.externalId);
          if (
            existing &&
            (existing.sku !== item.sku ||
              existing.quantity !== item.quantity ||
              existing.measuredAt !== item.measuredAt)
          ) {
            conflictingDuplicateIds.add(item.externalId);
            continue;
          }
          if (!existing) byExternalId.set(item.externalId, item);
        }

        const actualBySku = new Map<string, bigint>();
        for (const usage of byExternalId.values()) {
          actualBySku.set(
            usage.sku,
            (actualBySku.get(usage.sku) ?? 0n) + parseDecimal(usage.quantity),
          );
        }
        const expectedBySku = new Map<string, bigint>();
        for (const expected of input.expected) {
          expectedBySku.set(
            expected.sku,
            (expectedBySku.get(expected.sku) ?? 0n) +
              parseDecimal(expected.quantity),
          );
        }
        const skus = new Set([...actualBySku.keys(), ...expectedBySku.keys()]);
        const variances = [...skus]
          .sort((left, right) => left.localeCompare(right))
          .flatMap((sku) => {
            const expected = expectedBySku.get(sku) ?? 0n;
            const actual = actualBySku.get(sku) ?? 0n;
            if (expected === actual) return [];
            return [
              {
                sku,
                expected: formatDecimal(expected),
                actual: formatDecimal(actual),
                difference: formatDecimal(actual - expected),
              },
            ];
          });

        const expectedIds = new Set(
          input.expected.flatMap((expected) => expected.sourceUsageIds),
        );
        const actualIds = new Set(byExternalId.keys());
        const missingSourceUsageIds = [...expectedIds]
          .filter((id) => !actualIds.has(id))
          .sort();
        const unexpectedSourceUsageIds = [
          ...[...actualIds].filter((id) => !expectedIds.has(id)),
          ...conflictingDuplicateIds,
          ...outOfRangeIds,
        ].sort();

        let exceptionCaseId: string | undefined;
        if (
          variances.length > 0 ||
          missingSourceUsageIds.length > 0 ||
          unexpectedSourceUsageIds.length > 0
        ) {
          const exception = await this.openException({
            taskId: TASKS.reconcileUsage,
            context: input.context,
            invocationKey: key,
            queue: "reconciliation",
            code: "USAGE_RECONCILIATION_VARIANCE",
            safeDetail:
              "Commitment-ledger usage does not tie to deduplicated source usage for the reconciliation window.",
            severity: "warning",
            metadata: {
              ledgerId: input.ledgerId,
              organizationId: input.organizationId,
              varianceCount: variances.length.toString(),
              missingSourceCount: missingSourceUsageIds.length.toString(),
              unexpectedSourceCount: unexpectedSourceUsageIds.length.toString(),
            },
          });
          exceptionCaseId = exception.caseId;
        }
        const value = {
          variances,
          missingSourceUsageIds,
          unexpectedSourceUsageIds,
          ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
        };
        await this.record(key, input.context, {
          kind: "usage_reconciled",
          taskId: TASKS.reconcileUsage,
          input,
          sourceUsageIds: [...actualIds].sort(),
          variances,
          ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
        });
        return { kind: "success", value };
      },
    );
  }

  public async reconcileThreeWay(raw: unknown): Promise<
    WorkflowExecution<{
      variances: readonly {
        currency: string;
        platformMinor: string;
        billingProviderMinor: string;
        accountingMinor: string;
      }[];
      exceptionCaseId?: string;
    }>
  > {
    const input = parsePayload(ThreeWayReconciliationInputSchema, raw);
    return this.runControlled(
      TASKS.threeWay,
      "report_export",
      input,
      async (key) => {
        const platform = this.moneyTotals(input.platform);
        const billing = this.moneyTotals(input.billingProvider);
        const accounting = this.moneyTotals(input.accounting);
        const currencies = new Set([
          ...platform.keys(),
          ...billing.keys(),
          ...accounting.keys(),
        ]);
        const tolerance = BigInt(input.toleranceMinor);
        const variances = [...currencies].sort().flatMap((currency) => {
          const platformMinor = platform.get(currency) ?? 0n;
          const billingProviderMinor = billing.get(currency) ?? 0n;
          const accountingMinor = accounting.get(currency) ?? 0n;
          if (
            absolute(platformMinor - billingProviderMinor) <= tolerance &&
            absolute(platformMinor - accountingMinor) <= tolerance &&
            absolute(billingProviderMinor - accountingMinor) <= tolerance
          )
            return [];
          return [
            {
              currency,
              platformMinor: platformMinor.toString(),
              billingProviderMinor: billingProviderMinor.toString(),
              accountingMinor: accountingMinor.toString(),
            },
          ];
        });
        let exceptionCaseId: string | undefined;
        if (variances.length > 0) {
          const exception = await this.openException({
            taskId: TASKS.threeWay,
            context: input.context,
            invocationKey: key,
            queue: "reconciliation",
            code: "THREE_WAY_TIE_OUT_VARIANCE",
            safeDetail:
              "Commerce, billing-provider, and accounting totals do not tie within the configured minor-unit tolerance.",
            severity: "blocking",
            metadata: {
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              varianceCount: variances.length.toString(),
              toleranceMinor: input.toleranceMinor,
            },
          });
          exceptionCaseId = exception.caseId;
        }
        const value = {
          variances,
          ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
        };
        await this.record(key, input.context, {
          kind: "three_way_reconciled",
          taskId: TASKS.threeWay,
          input,
          variances,
          ...(exceptionCaseId === undefined ? {} : { exceptionCaseId }),
        });
        return { kind: "success", value };
      },
    );
  }

  public async exportReport(raw: unknown): Promise<
    WorkflowExecution<{
      rowCount: number;
      columns: readonly string[];
      rows: readonly ReportRow[];
      sourceVersion: string;
      contentHash: string;
      byteLength: number;
      documentId: string;
      storageKey: string;
      versionId: string;
      marginLabel?: "modeled" | "realized";
    }>
  > {
    const input = parsePayload(ExportReportInputSchema, raw);
    assertAggregate(
      input.context.aggregateId,
      input.reportExportId,
      "report export",
    );
    return this.runControlled(
      TASKS.exportReport,
      "report_export",
      input,
      async (key) => {
        const queried = await this.dependencies.reporting.query({
          reportType: input.reportType,
          asOf: input.asOf,
          ...(input.from === undefined ? {} : { from: input.from }),
          ...(input.to === undefined ? {} : { to: input.to }),
          ...(input.accountId === undefined
            ? {}
            : { accountId: input.accountId }),
          ...(input.partnerAccountId === undefined
            ? {}
            : { partnerAccountId: input.partnerAccountId }),
        });
        if (!queried.ok)
          return this.providerFailure(
            input.context,
            key,
            TASKS.exportReport,
            "reporting",
            "Report query",
            queried,
          );

        const marginLabel =
          input.reportType === "margin_poc_cost"
            ? input.costIngestionComplete
              ? ("realized" as const)
              : ("modeled" as const)
            : undefined;
        const rows =
          marginLabel === undefined
            ? queried.value.rows
            : queried.value.rows.map((row) => ({
                ...row,
                margin_basis: marginLabel,
              }));
        let csv: ReturnType<typeof renderCsv>;
        try {
          const requestedColumns =
            marginLabel === undefined || input.requestedColumns === undefined
              ? input.requestedColumns
              : input.requestedColumns.includes("margin_basis")
                ? input.requestedColumns
                : [...input.requestedColumns, "margin_basis"];
          csv = renderCsv(rows, requestedColumns);
        } catch {
          return this.permanentFailure(
            input.context,
            key,
            TASKS.exportReport,
            "reporting",
            "INVALID_REPORT_COLUMNS",
            "The requested CSV column selection does not match the report result.",
            {
              reportExportId: input.reportExportId,
              reportType: input.reportType,
            },
          );
        }
        const contentHash = sha256(csv.bytes);
        const stored = await this.dependencies.exports.putImmutable({
          kind: `report_export:${input.reportType}`,
          bytes: csv.bytes,
          contentHash,
          retainUntil: input.retainUntil,
        });
        if (!stored.ok)
          return this.providerFailure(
            input.context,
            key,
            TASKS.exportReport,
            "reporting",
            "Report export storage",
            stored,
          );
        const value = {
          rowCount: rows.length,
          columns: csv.columns,
          rows,
          sourceVersion: queried.value.sourceVersion,
          contentHash,
          byteLength: csv.bytes.byteLength,
          documentId: stored.value.documentId,
          storageKey: stored.value.storageKey,
          versionId: stored.value.versionId,
          ...(marginLabel === undefined ? {} : { marginLabel }),
        };
        await this.record(key, input.context, {
          kind: "report_exported",
          taskId: TASKS.exportReport,
          input,
          ...value,
        });
        return { kind: "success", value };
      },
    );
  }

  private async runControlled<
    TInput extends { context: CoreWorkflowContext },
    TValue,
  >(
    taskId: CoreWorkflowTaskId,
    aggregateType: string,
    input: TInput,
    work: (
      key: ReturnType<typeof invocationKey>,
    ) => Promise<WorkResult<TValue>>,
  ): Promise<WorkflowExecution<TValue>> {
    const key = invocationKey(taskId, aggregateType, input.context);
    let claim: Awaited<ReturnType<CoreWorkflowDependencies["runs"]["claim"]>>;
    try {
      claim = await this.dependencies.runs.claim({
        taskId,
        invocationKey: key,
        payloadHash: payloadHash(businessPayload(input)),
        aggregateId: input.context.aggregateId,
        aggregateVersion: input.context.aggregateVersion,
        requestId: input.context.requestId,
        ...(input.context.replay === undefined
          ? {}
          : {
              replay: {
                requestedBy: input.context.replay.requestedBy,
                reason: input.context.replay.reason,
                ...(input.context.replay.ticketReference === undefined
                  ? {}
                  : {
                      ticketReference: input.context.replay.ticketReference,
                    }),
              },
            }),
      });
    } catch {
      throw new TransientWorkflowError("WORKFLOW_RUN_STORE_UNAVAILABLE");
    }

    if (claim.status === "completed") {
      return {
        status: "completed",
        invocationKey: key,
        duplicate: true,
        value: claim.output as TValue,
      };
    }
    if (claim.status === "in_progress") {
      return { status: "in_progress", invocationKey: key };
    }
    if (claim.status === "permanent_failure") {
      const failure = claim.output as Omit<PermanentFailure, "duplicate">;
      return { ...failure, duplicate: true };
    }
    if (claim.status === "payload_conflict") {
      const failure = await this.permanentFailure(
        input.context,
        key,
        taskId,
        "workflow_operations",
        "IDEMPOTENCY_PAYLOAD_MISMATCH",
        "A workflow invocation reused the same aggregate version and operation with different business data.",
        { existingPayloadHash: claim.existingPayloadHash },
      );
      if (failure.kind !== "permanent_failure")
        throw new Error("Payload conflict must produce a permanent failure");
      return {
        status: "permanent_failure",
        invocationKey: key,
        duplicate: false,
        code: failure.code,
        safeDetail: failure.safeDetail,
        exceptionCaseId: failure.exceptionCaseId,
      };
    }

    try {
      const requirement = coreCapabilityRequirements[taskId];
      const authorization = await this.dependencies.capabilities.require({
        ...requirement,
        requestId: input.context.requestId,
      });
      const outcome = authorization.allowed
        ? await work(key)
        : await this.permanentFailure(
            input.context,
            key,
            taskId,
            "workflow_operations",
            "PERSISTED_CAPABILITY_DISABLED",
            "This command is disabled by the authoritative capability register.",
            {
              disabledCapabilities: authorization.disabled.join(","),
              recovery: String(requirement.recovery),
            },
          );
      if (outcome.kind === "permanent_failure") {
        const failure: PermanentFailure = {
          status: "permanent_failure",
          invocationKey: key,
          duplicate: false,
          code: outcome.code,
          safeDetail: outcome.safeDetail,
          exceptionCaseId: outcome.exceptionCaseId,
        };
        await this.dependencies.runs.markPermanentFailure({
          invocationKey: key,
          leaseToken: claim.leaseToken,
          output: failure,
          failedAt: input.context.occurredAt,
        });
        return failure;
      }
      await this.dependencies.runs.markCompleted({
        invocationKey: key,
        leaseToken: claim.leaseToken,
        output: outcome.value,
        completedAt: input.context.occurredAt,
      });
      return {
        status: "completed",
        invocationKey: key,
        duplicate: false,
        value: outcome.value,
      };
    } catch (error) {
      const transient =
        error instanceof TransientWorkflowError
          ? error
          : new TransientWorkflowError("WORKFLOW_DEPENDENCY_UNAVAILABLE");
      await this.dependencies.runs.markRetrying({
        invocationKey: key,
        leaseToken: claim.leaseToken,
        code: transient.code,
        ...(transient.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: transient.retryAfterMs }),
        failedAt: input.context.occurredAt,
      });
      throw transient;
    }
  }

  private providerFailure(
    context: CoreWorkflowContext,
    key: ReturnType<typeof invocationKey>,
    taskId: CoreWorkflowTaskId,
    queue: ExceptionQueue,
    operation: string,
    failure: ProviderFailure,
  ): Promise<WorkResult<never>> {
    if (failure.kind === "transient")
      throw new TransientWorkflowError(failure.code, failure.retryAfterMs);
    return this.permanentFailure(
      context,
      key,
      taskId,
      queue,
      failure.code,
      safeProviderDetail(operation, failure.code),
      { providerCode: failure.code, operation },
    );
  }

  private async permanentFailure(
    context: CoreWorkflowContext,
    key: ReturnType<typeof invocationKey>,
    taskId: CoreWorkflowTaskId,
    queue: ExceptionQueue,
    code: string,
    safeDetail: string,
    metadata: Record<string, string>,
  ): Promise<WorkResult<never>> {
    const opened = await this.openException({
      taskId,
      context,
      invocationKey: key,
      queue,
      code,
      safeDetail,
      severity: "blocking",
      metadata,
    });
    return {
      kind: "permanent_failure",
      code,
      safeDetail,
      exceptionCaseId: opened.caseId,
    };
  }

  private openException(input: {
    taskId: CoreWorkflowTaskId;
    context: CoreWorkflowContext;
    invocationKey: ReturnType<typeof invocationKey>;
    queue: ExceptionQueue;
    code: string;
    safeDetail: string;
    severity: WorkflowExceptionRequest["severity"];
    metadata: Record<string, string>;
  }) {
    return this.dependencies.exceptions.open({
      taskId: input.taskId,
      exceptionKey: downstreamIdempotencyKey(
        input.invocationKey,
        `exception-${input.code}`,
      ),
      queue: input.queue,
      code: input.code,
      safeDetail: input.safeDetail,
      aggregateId: input.context.aggregateId,
      aggregateVersion: input.context.aggregateVersion,
      requestId: input.context.requestId,
      occurredAt: input.context.occurredAt,
      severity: input.severity,
      ...(input.context.replay === undefined
        ? {}
        : {
            replay: {
              requestedBy: input.context.replay.requestedBy,
              reason: input.context.replay.reason,
              ...(input.context.replay.ticketReference === undefined
                ? {}
                : {
                    ticketReference: input.context.replay.ticketReference,
                  }),
            },
          }),
      metadata: input.metadata,
    });
  }

  private record(
    invocationKeyValue: ReturnType<typeof invocationKey>,
    context: CoreWorkflowContext,
    record: CoreWorkflowRecord,
  ) {
    return this.dependencies.records.record({
      invocationKey: invocationKeyValue,
      aggregateId: context.aggregateId,
      aggregateVersion: context.aggregateVersion,
      requestId: context.requestId,
      occurredAt: context.occurredAt,
      record,
    });
  }

  private moneyTotals(
    totals: readonly { currency: string; minor: string }[],
  ): Map<string, bigint> {
    const result = new Map<string, bigint>();
    for (const total of totals)
      result.set(
        total.currency,
        (result.get(total.currency) ?? 0n) + BigInt(total.minor),
      );
    return result;
  }
}
