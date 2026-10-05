import { z } from "zod";

import {
  assertDistinctOrSelfApproved,
  type SelfApproval,
} from "../../self-approval";

export const ChannelPolicyTermsSchema = z
  .object({
    version: z.number().int().positive(),
    effectiveFrom: z.iso.date(),
    selfServeThresholdTb: z.number().positive().max(1_000_000_000),
    defaultProtectionDays: z.number().int().min(1).max(730),
    maximumProtectionDays: z.number().int().min(1).max(730),
    extensionDays: z.number().int().min(1).max(730),
    maximumExtensions: z.number().int().min(0).max(10),
    sourceEvidence: z.string().trim().min(8).max(2000),
  })
  .strict()
  .refine(
    (value) => value.defaultProtectionDays <= value.maximumProtectionDays,
    "Default protection cannot exceed the maximum requested window",
  );
export type ChannelPolicyTerms = z.infer<typeof ChannelPolicyTermsSchema>;
export const ChannelPolicyRecordSchema = z
  .object({
    id: z.uuid(),
    rowVersion: z.number().int().positive(),
    status: z.enum(["draft", "proposed", "approved"]),
    terms: ChannelPolicyTermsSchema,
    createdBy: z.uuid(),
    lastEditedBy: z.uuid(),
    proposedBy: z.uuid().nullable(),
    approvedBy: z.uuid().nullable(),
    decisionReason: z.string(),
    approvalEvidence: z.string().nullable(),
    /** The approver approved a version they created, edited or proposed. */
    selfApproved: z.boolean().optional(),
    selfApprovalReason: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type ChannelPolicyRecord = z.infer<typeof ChannelPolicyRecordSchema>;
export const ChannelPolicyCommandSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), terms: ChannelPolicyTermsSchema })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      id: z.uuid(),
      expectedRowVersion: z.number().int().positive(),
      terms: ChannelPolicyTermsSchema,
    })
    .strict(),
  z
    .object({
      action: z.enum(["propose", "reject"]),
      id: z.uuid(),
      expectedRowVersion: z.number().int().positive(),
      reason: z.string().trim().min(8).max(2000),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      id: z.uuid(),
      expectedRowVersion: z.number().int().positive(),
      reason: z.string().trim().min(8).max(2000),
      approvalEvidence: z.string().trim().min(8).max(2000),
      /**
       * Approve one's own version under `approval:self`. The reason is then
       * also the self-approval reason, 8 to 500 characters.
       */
      selfApproval: z.literal(true).optional(),
    })
    .strict(),
]);
export type ChannelPolicyCommand = z.infer<typeof ChannelPolicyCommandSchema>;

/** Existing UI defaults, explicitly distinguished from an approved program. */
export const legacyChannelDefaults = {
  source: "legacy_defaults" as const,
  policyId: null,
  version: 0,
  selfServeThresholdTb: 100,
  defaultProtectionDays: 90,
  maximumProtectionDays: null,
  extensionDays: null,
  maximumExtensions: null,
};
export type ChannelPolicySnapshot =
  | typeof legacyChannelDefaults
  | {
      source: "approved_policy";
      policyId: string;
      version: number;
      selfServeThresholdTb: number;
      defaultProtectionDays: number;
      maximumProtectionDays: number;
      extensionDays: number;
      maximumExtensions: number;
    };
export function channelPolicySnapshot(
  record: ChannelPolicyRecord | undefined,
): ChannelPolicySnapshot {
  if (!record) return { ...legacyChannelDefaults };
  if (record.status !== "approved")
    throw new Error("CHANNEL_POLICY_APPROVED_REQUIRED");
  return {
    source: "approved_policy",
    policyId: record.id,
    version: record.terms.version,
    selfServeThresholdTb: record.terms.selfServeThresholdTb,
    defaultProtectionDays: record.terms.defaultProtectionDays,
    maximumProtectionDays: record.terms.maximumProtectionDays,
    extensionDays: record.terms.extensionDays,
    maximumExtensions: record.terms.maximumExtensions,
  };
}
export function applyChannelPolicyCommand(input: {
  current: ChannelPolicyRecord;
  command: Exclude<ChannelPolicyCommand, { action: "create" }>;
  userId: string;
  now: string;
  /**
   * The approver's own version, approved under `approval:self`. The caller
   * has checked the authority; this records it.
   */
  selfApproval?: SelfApproval;
}): ChannelPolicyRecord {
  const { current, command, userId, now } = input;
  if (input.selfApproval && command.action !== "approve")
    throw new Error("SELF_APPROVAL_APPROVE_ONLY");
  if (
    current.id !== command.id ||
    current.rowVersion !== command.expectedRowVersion
  )
    throw new Error("CHANNEL_POLICY_VERSION_CONFLICT");
  if (current.status === "approved")
    throw new Error("CHANNEL_POLICY_IMMUTABLE");
  const next = {
    ...current,
    rowVersion: current.rowVersion + 1,
    updatedAt: now,
  };
  if (command.action === "save") {
    if (current.status !== "draft") throw new Error("CHANNEL_POLICY_NOT_DRAFT");
    return {
      ...next,
      terms: ChannelPolicyTermsSchema.parse(command.terms),
      lastEditedBy: userId,
    };
  }
  if (command.action === "propose") {
    if (current.status !== "draft") throw new Error("CHANNEL_POLICY_NOT_DRAFT");
    return {
      ...next,
      status: "proposed",
      proposedBy: userId,
      decisionReason: command.reason,
    };
  }
  if (current.status !== "proposed")
    throw new Error("CHANNEL_POLICY_NOT_PROPOSED");
  const selfApproved = assertDistinctOrSelfApproved({
    deciderId: userId,
    requesterIds: [current.createdBy, current.lastEditedBy, current.proposedBy],
    selfApproval: input.selfApproval,
    distinctError: "CHANNEL_POLICY_DISTINCT_APPROVER_REQUIRED",
  });
  if (command.action === "reject")
    return {
      ...next,
      status: "draft",
      proposedBy: null,
      decisionReason: command.reason,
    };
  if (command.action !== "approve")
    throw new Error("CHANNEL_POLICY_TRANSITION_INVALID");
  if (current.terms.effectiveFrom < now.slice(0, 10))
    throw new Error("CHANNEL_POLICY_BACKDATED_APPROVAL");
  return {
    ...next,
    status: "approved",
    approvedBy: userId,
    approvalEvidence: command.approvalEvidence,
    decisionReason: command.reason,
    ...(selfApproved && input.selfApproval
      ? {
          selfApproved: true,
          selfApprovalReason: input.selfApproval.reason.trim(),
        }
      : {}),
  };
}
