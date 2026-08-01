import type {
  AccountingPort,
  BillingPort,
  EvidenceStoragePort,
  IdempotencyKey,
  NotificationPort,
  OrchestratorUsagePort,
  ProviderResult,
} from "@clockwork/contracts";
import type {
  CommissionSettlementAccountingPort,
  StripeLedgerBillingPort,
} from "@clockwork/integrations/core";

import type {
  CoreWorkflowContext,
  DunningInput,
  ExportReportInput,
  IssueInvoiceInput,
  PartnerCreditInput,
  ReconcileUsageInput,
  SettleCommissionsInput,
  SyncOverageInput,
  ThreeWayReconciliationInput,
} from "./schemas";

export const coreWorkflowTaskIds = [
  "core.billing.issue-invoice.v1",
  "core.billing.sync-overage.v1",
  "core.collections.dunning.v1",
  "core.collections.partner-credit.v1",
  "core.commissions.settle.v1",
  "core.reconciliation.usage.v1",
  "core.reconciliation.three-way.v1",
  "core.reporting.export.v1",
] as const;

export type CoreWorkflowTaskId = (typeof coreWorkflowTaskIds)[number];

export type CoreCapabilityKey =
  "new_business" | "legal" | "billing" | "partner" | "marketplace" | "teardown";

export interface CoreCapabilityGuard {
  require(input: {
    capabilities: readonly CoreCapabilityKey[];
    recovery: boolean;
    requestId: string;
  }): Promise<{ allowed: boolean; disabled: readonly CoreCapabilityKey[] }>;
}

export type ExceptionQueue =
  | "billing_operations"
  | "credit_collections"
  | "commissions"
  | "reconciliation"
  | "reporting"
  | "workflow_operations";

export interface WorkflowExceptionRequest {
  taskId: CoreWorkflowTaskId;
  exceptionKey: IdempotencyKey;
  queue: ExceptionQueue;
  code: string;
  safeDetail: string;
  aggregateId: string;
  aggregateVersion: number;
  requestId: string;
  occurredAt: string;
  severity: "warning" | "blocking";
  replay?: {
    requestedBy: string;
    reason: string;
    ticketReference?: string;
  };
  metadata: Record<string, string>;
}

/**
 * Implementations must create the exception case, audit row, and outbox row in
 * one authorized transaction. `exceptionKey` is unique and makes replay safe.
 */
export interface WorkflowExceptionPort {
  open(
    request: WorkflowExceptionRequest,
  ): Promise<{ caseId: string; duplicate?: boolean }>;
}

export type WorkflowClaim =
  | { status: "acquired"; attempt: number; leaseToken: string }
  | { status: "completed"; output: unknown }
  | { status: "in_progress" }
  | { status: "permanent_failure"; output: unknown }
  | { status: "payload_conflict"; existingPayloadHash: string };

export interface WorkflowClaimRequest {
  taskId: CoreWorkflowTaskId;
  invocationKey: IdempotencyKey;
  payloadHash: string;
  aggregateId: string;
  aggregateVersion: number;
  requestId: string;
  replay?: CoreWorkflowContext["replay"];
}

/** Database-backed in production; mirrors Trigger run IDs and outcomes. */
export interface WorkflowRunStore {
  claim(request: WorkflowClaimRequest): Promise<WorkflowClaim>;
  markCompleted(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    output: unknown;
    completedAt: string;
  }): Promise<void>;
  markRetrying(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    code: string;
    retryAfterMs?: number;
    failedAt: string;
  }): Promise<void>;
  markPermanentFailure(input: {
    invocationKey: IdempotencyKey;
    leaseToken: string;
    output: unknown;
    failedAt: string;
  }): Promise<void>;
}

export type MeteredBillingPort = StripeLedgerBillingPort;

export type ReportScalar = string | number | boolean | null;
export type ReportRow = Readonly<Record<string, ReportScalar>>;

export interface ReportingDataPort {
  query(input: {
    reportType: ExportReportInput["reportType"];
    asOf: string;
    from?: string;
    to?: string;
    accountId?: string;
    partnerAccountId?: string;
  }): Promise<
    ProviderResult<{ rows: readonly ReportRow[]; sourceVersion: string }>
  >;
}

export type CoreWorkflowRecord =
  | {
      kind: "invoice_issued";
      taskId: "core.billing.issue-invoice.v1";
      input: IssueInvoiceInput;
      providerInvoiceId: string;
      providerStatus: string;
      accountingPostingId?: string;
    }
  | {
      kind: "overage_synced";
      taskId: "core.billing.sync-overage.v1";
      input: SyncOverageInput;
      providerInvoiceItemIds: readonly string[];
      duplicateSourceUsageIds: readonly string[];
    }
  | {
      kind: "dunning_decided";
      taskId: "core.collections.dunning.v1";
      input: DunningInput;
      decision: {
        stage: string;
        pauseNewCommerce: boolean;
        writeSuspensionRequiresReview: boolean;
        deletionPermitted: false;
        retentionBlockedUntil: string | null;
        exceptionCaseId?: string;
      };
      notificationMessageId?: string;
    }
  | {
      kind: "partner_credit_decided";
      taskId: "core.collections.partner-credit.v1";
      input: PartnerCreditInput;
      decision: {
        allowNewService: boolean;
        projectedExposureMinor: string;
        reason: string;
        exceptionCaseId?: string;
      };
    }
  | {
      kind: "commissions_settled";
      taskId: "core.commissions.settle.v1";
      input: SettleCommissionsInput;
      payableMinor: string;
      heldMinor: string;
      accrualIds: readonly string[];
      lineBindingHash: string;
      billId?: string;
    }
  | {
      kind: "usage_reconciled";
      taskId: "core.reconciliation.usage.v1";
      input: ReconcileUsageInput;
      sourceUsageIds: readonly string[];
      variances: readonly {
        sku: string;
        expected: string;
        actual: string;
        difference: string;
      }[];
      exceptionCaseId?: string;
    }
  | {
      kind: "three_way_reconciled";
      taskId: "core.reconciliation.three-way.v1";
      input: ThreeWayReconciliationInput;
      variances: readonly {
        currency: string;
        platformMinor: string;
        billingProviderMinor: string;
        accountingMinor: string;
      }[];
      exceptionCaseId?: string;
    }
  | {
      kind: "report_exported";
      taskId: "core.reporting.export.v1";
      input: ExportReportInput;
      rowCount: number;
      sourceVersion: string;
      contentHash: string;
      documentId: string;
      storageKey: string;
      versionId: string;
      marginLabel?: "modeled" | "realized";
    };

/**
 * Implementations persist the lane result plus its audit/outbox projections in
 * one transaction, unique on invocationKey. Provider calls intentionally occur
 * first and are safe to repeat with their downstream idempotency keys.
 */
export interface CoreWorkflowRecordPort {
  record(input: {
    invocationKey: IdempotencyKey;
    aggregateId: string;
    aggregateVersion: number;
    requestId: string;
    occurredAt: string;
    record: CoreWorkflowRecord;
  }): Promise<{ duplicate?: boolean }>;
}

/**
 * Atomically commits the provider-accepted bill binding, the exact statement
 * line/accrual set, and the settlement audit/outbox evidence.
 */
export interface CommissionSettlementPort {
  validate(input: {
    statementId: string;
    partnerAccountId: string;
    expectedRowVersion: number;
    currency: SettleCommissionsInput["currency"];
    payableMinor: string;
    accrualIds: readonly string[];
    exportKey: string;
  }): Promise<{ duplicate?: boolean }>;
  finalize(input: {
    statementId: string;
    partnerAccountId: string;
    expectedRowVersion: number;
    currency: SettleCommissionsInput["currency"];
    payableMinor: string;
    accrualIds: readonly string[];
    exportKey: string;
    providerBillId?: string;
    requestId: string;
    occurredAt: string;
  }): Promise<{ duplicate?: boolean }>;
}

export interface CoreWorkflowDependencies {
  capabilities: CoreCapabilityGuard;
  runs: WorkflowRunStore;
  exceptions: WorkflowExceptionPort;
  records: CoreWorkflowRecordPort;
  billing: BillingPort;
  metering: MeteredBillingPort;
  accounting: AccountingPort;
  commissionAccounting: CommissionSettlementAccountingPort;
  commissionSettlements: CommissionSettlementPort;
  notifications: NotificationPort;
  usage: OrchestratorUsagePort;
  reporting: ReportingDataPort;
  exports: EvidenceStoragePort;
}
