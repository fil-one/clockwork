import {
  CurrencySchema,
  EmailSchema,
  IdempotencyKeySchema,
  IsoDateTimeSchema,
  LocalDateSchema,
  MoneySchema,
  QuantitySchema,
  ids,
} from "@clockwork/contracts";
import { z } from "zod";

export const ReplayRequestSchema = z
  .object({
    requestedBy: z.string().min(1).max(255),
    reason: z.string().min(10).max(1_000),
    ticketReference: z.string().min(1).max(255).optional(),
  })
  .strict();

export const CoreWorkflowContextSchema = z
  .object({
    aggregateId: z.uuid(),
    aggregateVersion: z.int().positive(),
    requestId: ids.request,
    occurredAt: IsoDateTimeSchema,
    replay: ReplayRequestSchema.optional(),
  })
  .strict();

const InvoiceGroupSchema = z
  .object({
    endClientAccountId: ids.account,
    amount: MoneySchema,
    description: z.string().min(1).max(500),
  })
  .strict();

export const IssueInvoiceInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    invoiceId: ids.invoice,
    orderId: ids.order,
    billingAccountId: ids.account,
    customerId: z.string().min(1).max(255),
    commercialShape: z.enum([
      "direct",
      "referral",
      "resale",
      "distributor",
      "marketplace",
    ]),
    collectionMethod: z.enum(["auto_charge", "bank_transfer", "net_terms"]),
    amount: MoneySchema,
    poNumber: z.string().min(1).max(100).optional(),
    apEmail: EmailSchema.optional(),
    vendorSetupComplete: z.boolean(),
    groups: z.array(InvoiceGroupSchema).max(10_000).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (BigInt(input.amount.minor) <= 0n) {
      context.addIssue({
        code: "custom",
        path: ["amount", "minor"],
        message:
          "Invoice amount must be positive; credits use the credit-note workflow",
      });
    }
    if (
      input.collectionMethod === "net_terms" &&
      (!input.poNumber || !input.apEmail || !input.vendorSetupComplete)
    ) {
      context.addIssue({
        code: "custom",
        path: ["collectionMethod"],
        message:
          "Net-terms invoices require a PO, AP contact, and completed vendor setup",
      });
    }
    const partnerInvoice =
      input.commercialShape === "resale" ||
      input.commercialShape === "distributor";
    if (partnerInvoice && input.groups.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["groups"],
        message: "Partner invoices require end-client line grouping",
      });
    }
    const partnerEndClients = new Set<string>();
    for (const [index, group] of input.groups.entries()) {
      if (BigInt(group.amount.minor) < 0n) {
        context.addIssue({
          code: "custom",
          path: ["groups", index, "amount", "minor"],
          message: "Invoice groups cannot contain negative amounts",
        });
      }
      if (group.amount.currency !== input.amount.currency) {
        context.addIssue({
          code: "custom",
          path: ["groups", index, "amount", "currency"],
          message: "Invoice group currency must match the invoice currency",
        });
      }
      if (
        partnerInvoice &&
        group.endClientAccountId === input.billingAccountId
      ) {
        context.addIssue({
          code: "custom",
          path: ["groups", index, "endClientAccountId"],
          message: "A partner invoice group must identify its end client",
        });
      }
      if (partnerInvoice && partnerEndClients.has(group.endClientAccountId)) {
        context.addIssue({
          code: "custom",
          path: ["groups", index, "endClientAccountId"],
          message:
            "Partner invoice amounts must be consolidated once per end client",
        });
      }
      partnerEndClients.add(group.endClientAccountId);
    }
    if (input.groups.length > 0) {
      const groupedMinor = input.groups.reduce(
        (sum, group) => sum + BigInt(group.amount.minor),
        0n,
      );
      if (groupedMinor !== BigInt(input.amount.minor)) {
        context.addIssue({
          code: "custom",
          path: ["groups"],
          message: "Invoice group amounts must exactly equal the invoice total",
        });
      }
    }
  });

export const SyncOverageInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    periodId: z.uuid(),
    ledgerId: ids.commitmentLedger,
    orderId: ids.order,
    invoiceId: ids.invoice,
    providerInvoiceId: z.string().min(1).max(255),
    customerId: z.string().min(1).max(255),
    periodStart: IsoDateTimeSchema,
    periodEnd: IsoDateTimeSchema,
    lines: z
      .array(
        z
          .object({
            ledgerEntryId: ids.commitmentEntry,
            sku: z.string().min(1).max(255),
            taxCode: z.string().min(1).max(255),
            quantity: QuantitySchema,
            contractedUnitRate: MoneySchema,
            amount: MoneySchema,
            sourceUsageIds: z.array(z.string().min(1).max(255)).min(1),
          })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (Date.parse(input.periodStart) >= Date.parse(input.periodEnd)) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "Overage period must end after it starts",
      });
    }
    const currencies = new Set(
      input.lines.flatMap((line) => [
        line.amount.currency,
        line.contractedUnitRate.currency,
      ]),
    );
    if (currencies.size > 1) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "An overage posting cannot mix currencies",
      });
    }
    const sourceUsageIds = new Set<string>();
    for (const [index, line] of input.lines.entries()) {
      if (line.quantity === "0" || BigInt(line.amount.minor) <= 0n) {
        context.addIssue({
          code: "custom",
          path: ["lines", index],
          message:
            "Only positive ledger-authorized overage lines may be synchronized",
        });
      }
      for (const sourceUsageId of line.sourceUsageIds) {
        if (sourceUsageIds.has(sourceUsageId)) {
          context.addIssue({
            code: "custom",
            path: ["lines", index, "sourceUsageIds"],
            message: "A source usage event can authorize only one overage line",
          });
        }
        sourceUsageIds.add(sourceUsageId);
      }
    }
  });

export const DunningInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    invoiceId: ids.invoice,
    billingAccountId: ids.account,
    commercialShape: z.enum(["direct", "referral", "resale", "distributor"]),
    invoiceStatus: z.enum(["open", "past_due", "uncollectible", "paid"]),
    daysPastDue: z.int().min(0).max(10_000),
    firstThresholdDays: z.int().min(0).max(10_000),
    secondThresholdDays: z.int().min(1).max(10_000),
    maxRetentionUntil: IsoDateTimeSchema.nullable(),
    retentionLiabilityRule: z.enum([
      "customer_pays_through_retention",
      "retention_capped_at_paid_term",
      "manual_review",
    ]),
    serviceRunning: z.boolean(),
    collectionsOwner: EmailSchema,
    billingRecipients: z.array(EmailSchema).min(1).max(100),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.secondThresholdDays <= input.firstThresholdDays) {
      context.addIssue({
        code: "custom",
        path: ["secondThresholdDays"],
        message: "The second dunning threshold must follow the first",
      });
    }
  });

export const PartnerCreditInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    partnerAccountId: ids.account,
    orderId: ids.order,
    serviceKind: z.enum(["new_end_client", "expansion", "running_service"]),
    creditPolicy: z.enum(["prepay", "auto_charge", "net_terms"]),
    currency: CurrencySchema,
    currentExposureMinor: z.string().regex(/^(0|[1-9]\d*)$/),
    requestedExposureMinor: z.string().regex(/^(0|[1-9]\d*)$/),
    creditLimitMinor: z.string().regex(/^(0|[1-9]\d*)$/),
    hasRequiredPaymentHistory: z.boolean(),
    collectionsOwner: EmailSchema,
  })
  .strict();

const CommissionAccrualInputSchema = z
  .object({
    accrualId: ids.commissionAccrual,
    invoiceId: ids.invoice,
    currency: CurrencySchema,
    collectedRevenueMinor: z.string().regex(/^-?(0|[1-9]\d*)$/),
    commissionMinor: z.string().regex(/^-?(0|[1-9]\d*)$/),
    holdbackMinor: z.string().regex(/^-?(0|[1-9]\d*)$/),
    status: z.enum(["accrued", "stated", "paid"]),
  })
  .strict();

export const SettleCommissionsInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    statementId: ids.document,
    partnerAccountId: ids.account,
    periodStart: LocalDateSchema,
    periodEnd: LocalDateSchema,
    currency: CurrencySchema,
    accruals: z.array(CommissionAccrualInputSchema).min(1).max(100_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.periodStart > input.periodEnd) {
      context.addIssue({
        code: "custom",
        path: ["periodEnd"],
        message: "Commission period must not end before it starts",
      });
    }
    const accrualIds = new Set<string>();
    for (const [index, accrual] of input.accruals.entries()) {
      if (accrualIds.has(accrual.accrualId)) {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "accrualId"],
          message: "A commission statement cannot settle one accrual twice",
        });
      }
      accrualIds.add(accrual.accrualId);
      if (accrual.status !== "stated") {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "status"],
          message: "Every included commission accrual must be stated",
        });
      }
      if (accrual.currency !== input.currency) {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "currency"],
          message: "Commission statement currency must be homogeneous",
        });
      }
      const commission = BigInt(accrual.commissionMinor);
      const collected = BigInt(accrual.collectedRevenueMinor);
      const holdback = BigInt(accrual.holdbackMinor);
      if (
        (collected > 0n && commission < 0n) ||
        (collected < 0n && commission > 0n) ||
        (collected === 0n && commission !== 0n)
      ) {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "commissionMinor"],
          message:
            "Commission direction must match persisted collected revenue",
        });
      }
      if (commission < 0n && holdback > 0n) {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "holdbackMinor"],
          message: "Clawback holdback adjustments cannot be positive",
        });
      }
      if (commission < 0n && holdback < commission) {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "holdbackMinor"],
          message: "Clawback holdback release cannot exceed the clawback",
        });
      }
      if (commission >= 0n && holdback > commission) {
        context.addIssue({
          code: "custom",
          path: ["accruals", index, "holdbackMinor"],
          message: "Commission holdback cannot exceed its positive accrual",
        });
      }
    }
  });

const ExpectedUsageSchema = z
  .object({
    sku: z.string().min(1).max(255),
    quantity: QuantitySchema,
    sourceUsageIds: z.array(z.string().min(1).max(255)).max(100_000),
  })
  .strict();

export const ReconcileUsageInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    ledgerId: ids.commitmentLedger,
    organizationId: ids.organization,
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
    expected: z.array(ExpectedUsageSchema).max(100_000),
  })
  .strict()
  .superRefine((input, context) => {
    if (Date.parse(input.from) >= Date.parse(input.to)) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Reconciliation range must end after it starts",
      });
    }
  });

const CurrencyTotalSchema = z
  .object({
    currency: CurrencySchema,
    minor: z.string().regex(/^-?(0|[1-9]\d*)$/),
  })
  .strict();

export const ThreeWayReconciliationInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    periodStart: LocalDateSchema,
    periodEnd: LocalDateSchema,
    platform: z.array(CurrencyTotalSchema).max(10),
    billingProvider: z.array(CurrencyTotalSchema).max(10),
    accounting: z.array(CurrencyTotalSchema).max(10),
    toleranceMinor: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .default("0"),
  })
  .strict();

export const ReportTypeSchema = z.enum([
  "revenue_forecast",
  "capacity_planning",
  "renewal_churn_exposure",
  "partner_performance",
  "funnel_cycle_time",
  "margin_poc_cost",
  "weekly_scorecard",
]);

export const ExportReportInputSchema = z
  .object({
    context: CoreWorkflowContextSchema,
    reportExportId: ids.reportExport,
    reportType: ReportTypeSchema,
    asOf: IsoDateTimeSchema,
    from: LocalDateSchema.optional(),
    to: LocalDateSchema.optional(),
    accountId: ids.account.optional(),
    partnerAccountId: ids.account.optional(),
    requestedColumns: z.array(z.string().min(1).max(255)).max(250).optional(),
    costIngestionComplete: z.boolean().default(false),
    retainUntil: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.from && input.to && input.from > input.to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Report range must not end before it starts",
      });
    }
  });

export const MeteredOverageProviderInputSchema = z
  .object({
    invoiceId: ids.invoice,
    providerInvoiceId: z.string().min(1),
    orderId: ids.order,
    customerId: z.string().min(1),
    lines: SyncOverageInputSchema.shape.lines,
    idempotencyKey: IdempotencyKeySchema,
  })
  .strict();

export type ReplayRequest = z.infer<typeof ReplayRequestSchema>;
export type CoreWorkflowContext = z.infer<typeof CoreWorkflowContextSchema>;
export type IssueInvoiceInput = z.infer<typeof IssueInvoiceInputSchema>;
export type SyncOverageInput = z.infer<typeof SyncOverageInputSchema>;
export type DunningInput = z.infer<typeof DunningInputSchema>;
export type PartnerCreditInput = z.infer<typeof PartnerCreditInputSchema>;
export type SettleCommissionsInput = z.infer<
  typeof SettleCommissionsInputSchema
>;
export type ReconcileUsageInput = z.infer<typeof ReconcileUsageInputSchema>;
export type ThreeWayReconciliationInput = z.infer<
  typeof ThreeWayReconciliationInputSchema
>;
export type ExportReportInput = z.infer<typeof ExportReportInputSchema>;
export type ReportType = z.infer<typeof ReportTypeSchema>;
