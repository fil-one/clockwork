import { z } from "zod";
import {
  assertDistinctOrSelfApproved,
  type SelfApproval,
} from "../../self-approval";
import { CustomerAcquisitionPolicySchema } from "./acquisition-policy";

const integer = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .max(38);
const text = z.string().trim().min(1).max(255);
export const PaygOfferTermsSchema = z
  .object({
    name: text,
    sku: text,
    region: text,
    version: z.number().int().positive(),
    effectiveFrom: z.iso.date(),
    sourceUri: z
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }, "Use an HTTPS evidence reference without credentials, query strings, or fragments"),
    sourceCheckedAt: z.iso.datetime(),
    sourceDocumentId: text,
    owner: text,
    customerAcquisition: CustomerAcquisitionPolicySchema.optional(),
    payg: z
      .object({
        currency: z.enum(["USD", "EUR", "GBP"]),
        storageTbMonthMinor: integer,
        monthlyMinimumMinor: integer,
        partialMonthMinimum: z.enum(["full", "prorated"]),
        correctionWindowDays: z.number().int().min(0).max(3650),
        aggregation: z.literal("hourly_average_daily_utc"),
        egressRateMinor: z.literal("0"),
        apiRateMinor: z.literal("0"),
        stripeTaxCode: text,
        qboIncomeAccount: text,
      })
      .strict(),
    trial: z
      .object({
        durationDays: z.number().int().min(1).max(365),
        gracePeriodDays: z.number().int().min(0).max(365),
        storageLimitBytes: integer.refine((value) => BigInt(value) > 0n),
        cumulativeEgressLimitBytes: integer.refine(
          (value) => BigInt(value) > 0n,
        ),
        maximumCounterAgeSeconds: z.number().int().min(1).max(86400),
        egressExhaustion: z.enum(["disable_all", "block_egress"]),
      })
      .strict(),
  })
  .strict();

export type PaygOfferTerms = z.infer<typeof PaygOfferTermsSchema>;
export const PaygOfferRecordSchema = z
  .object({
    id: z.uuid(),
    rowVersion: z.number().int().positive(),
    status: z.enum(["draft", "proposed", "approved", "retired"]),
    terms: PaygOfferTermsSchema,
    createdBy: z.uuid(),
    lastEditedBy: z.uuid(),
    proposedBy: z.uuid().nullable(),
    approvedBy: z.uuid().nullable(),
    approvalEvidenceId: z.string().nullable(),
    decisionReason: z.string(),
    /** The approver approved a version they created, edited or proposed. */
    selfApproved: z.boolean().optional(),
    selfApprovalReason: z.string().nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type PaygOfferRecord = z.infer<typeof PaygOfferRecordSchema>;

export const PaygOfferCommandSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), terms: PaygOfferTermsSchema })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      id: z.uuid(),
      expectedRowVersion: z.number().int().positive(),
      terms: PaygOfferTermsSchema,
    })
    .strict(),
  z
    .object({
      action: z.enum(["propose", "approve", "reject", "retire"]),
      id: z.uuid(),
      expectedRowVersion: z.number().int().positive(),
      reason: z.string().trim().min(8).max(2000),
      approvalEvidenceId: z.string().trim().min(1).max(255).optional(),
      /**
       * Approve one's own version under `approval:self`. The reason is then
       * also the self-approval reason, 8 to 500 characters.
       */
      selfApproval: z.literal(true).optional(),
    })
    .strict(),
]);
export type PaygOfferCommand = z.infer<typeof PaygOfferCommandSchema>;

/** Approval qualifies immutable policy; a separate capability + cutover enables sales. */
export function applyPaygOfferCommand(input: {
  current: PaygOfferRecord;
  command: Exclude<PaygOfferCommand, { action: "create" }>;
  userId: string;
  now: string;
  /**
   * The approver's own version, approved under `approval:self`. The caller
   * has checked the authority; this records it.
   */
  selfApproval?: SelfApproval;
}): PaygOfferRecord {
  const { current, command, userId } = input;
  if (input.selfApproval && command.action !== "approve")
    throw new Error("SELF_APPROVAL_APPROVE_ONLY");
  if (
    current.id !== command.id ||
    current.rowVersion !== command.expectedRowVersion
  )
    throw new Error("PAYG_OFFER_STALE_VERSION");
  const next = {
    ...structuredClone(current),
    rowVersion: current.rowVersion + 1,
    updatedAt: input.now,
  };
  if (command.action === "save") {
    if (current.status !== "draft") throw new Error("PAYG_OFFER_NOT_DRAFT");
    next.terms = PaygOfferTermsSchema.parse(command.terms);
    next.lastEditedBy = userId;
  } else {
    next.decisionReason = command.reason;
    if (command.action === "propose") {
      if (current.status !== "draft") throw new Error("PAYG_OFFER_NOT_DRAFT");
      next.status = "proposed";
      next.proposedBy = userId;
    } else if (command.action === "approve" || command.action === "reject") {
      if (current.status !== "proposed")
        throw new Error("PAYG_OFFER_NOT_PROPOSED");
      const selfApproved = assertDistinctOrSelfApproved({
        deciderId: userId,
        requesterIds: [
          current.createdBy,
          current.lastEditedBy,
          current.proposedBy,
        ],
        selfApproval: input.selfApproval,
        distinctError: "PAYG_OFFER_DISTINCT_APPROVER_REQUIRED",
      });
      if (command.action === "approve") {
        if (!command.approvalEvidenceId?.trim())
          throw new Error("PAYG_OFFER_APPROVAL_EVIDENCE_REQUIRED");
        next.status = "approved";
        next.approvedBy = userId;
        next.approvalEvidenceId = command.approvalEvidenceId;
        if (selfApproved && input.selfApproval) {
          next.selfApproved = true;
          next.selfApprovalReason = input.selfApproval.reason.trim();
        }
      } else {
        next.status = "draft";
        next.proposedBy = null;
      }
    } else {
      if (current.status !== "approved")
        throw new Error("PAYG_OFFER_NOT_APPROVED");
      next.status = "retired";
    }
  }
  if (Date.parse(next.terms.sourceCheckedAt) > Date.parse(input.now))
    throw new Error("PAYG_OFFER_SOURCE_CHECKED_IN_FUTURE");
  return PaygOfferRecordSchema.parse(next);
}
