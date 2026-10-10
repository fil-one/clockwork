"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { contextHasPermission, uuidV7 } from "@clockwork/contracts";
import {
  DatabaseChannelPolicyRepository,
  DatabaseSystemCapabilityAdmin,
  systemCapabilityKeys,
} from "@clockwork/db";
import { ChannelPolicyCommandSchema } from "@clockwork/domain/core";

import {
  requireRecentAuthentication,
  SessionExpiredError,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import type { MessageId } from "@/src/i18n";

import { sessionExpiredMessage } from "../session-expiry-message";

import {
  mayApproveOwnRequests,
  selfApprovalErrorMessage,
  selfApprovalReasonMaximum,
  selfApprovalReasonMinimum,
} from "./model";

/**
 * "Approve my own request" for the two controls whose approvals run as server
 * actions: capability switches and channel policy. Price books, PAYG offers
 * and exceptions use their API commands with the self-approval flag.
 *
 * Each action checks the session here (own session, MFA verified,
 * `approval:self`); the repository checks the stored memberships, and the
 * database records the reason, the `approval.self_approved` audit event and
 * the notices to the other commerce administrators.
 */
export type SelfApprovalActionResult =
  { ok: true } | { ok: false; message: MessageId };

const refused = (message: MessageId): SelfApprovalActionResult => ({
  ok: false,
  message,
});

/** Codes that mean the request moved on while the reader was looking. */
const staleCodes = new Set([
  "CAPABILITY_VERSION_CONFLICT",
  "CAPABILITY_REQUEST_EXPIRED",
  "CAPABILITY_REQUEST_NOT_PENDING",
  "CHANNEL_POLICY_VERSION_CONFLICT",
  "CHANNEL_POLICY_NOT_PROPOSED",
  "CHANNEL_POLICY_IMMUTABLE",
  "CHANNEL_POLICY_BACKDATED_APPROVAL",
]);

function failure(error: unknown): SelfApprovalActionResult {
  const code = error instanceof Error ? error.message : "";
  if (staleCodes.has(code)) return refused("common.selfApproval.error.stale");
  if (
    code === "CAPABILITY_AUTHORITY_REQUIRED" ||
    code === "CHANNEL_POLICY_FINANCE_REQUIRED"
  )
    return refused("common.selfApproval.error.notPermitted");
  return refused(selfApprovalErrorMessage(error));
}

async function selfApprovalSession() {
  try {
    const session = await requireRecentAuthentication();
    return session.providerBacked &&
      session.isInternalStaff &&
      session.mfaVerified &&
      contextHasPermission(session, "approval:self") &&
      mayApproveOwnRequests(session)
      ? session
      : null;
  } catch (error) {
    // An expired access token is reported apart: a reload fixes it.
    return error instanceof SessionExpiredError ? "expired" : null;
  }
}

const Reason = z
  .string()
  .trim()
  .min(selfApprovalReasonMinimum)
  .max(selfApprovalReasonMaximum);

const OwnCapabilitySchema = z
  .object({
    capabilityKey: z.enum(systemCapabilityKeys),
    expectedRowVersion: z.number().int().positive(),
    proposalId: z.uuid(),
    reason: Reason,
  })
  .strict();

/** Approves an activation request the reader raised on a capability switch. */
export async function approveOwnCapability(input: {
  capabilityKey: string;
  expectedRowVersion: number;
  proposalId: string;
  reason: string;
}): Promise<SelfApprovalActionResult> {
  const session = await selfApprovalSession();
  if (session === "expired") return refused(sessionExpiredMessage);
  if (!session) return refused("common.selfApproval.error.notPermitted");
  const parsed = OwnCapabilitySchema.safeParse(input);
  if (!parsed.success) return refused("common.selfApproval.error.reason");
  try {
    await new DatabaseSystemCapabilityAdmin(getServiceDatabase()).decide({
      capabilityKey: parsed.data.capabilityKey,
      expectedRowVersion: parsed.data.expectedRowVersion,
      actor: { kind: "user", id: session.userId },
      reason: parsed.data.reason,
      now: new Date(),
      requestId: `capability:${uuidV7()}`,
      proposalId: parsed.data.proposalId,
      approve: true,
      selfApproval: { reason: parsed.data.reason },
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/internal/capabilities");
  revalidatePath("/internal/owner");
  return { ok: true };
}

/**
 * Approves a proposed channel policy version the reader created, edited or
 * proposed. The approval evidence is the same the ordinary approval needs.
 */
export async function approveOwnChannelPolicy(input: {
  id: string;
  expectedRowVersion: number;
  reason: string;
  approvalEvidence: string;
}): Promise<SelfApprovalActionResult> {
  const session = await selfApprovalSession();
  if (session === "expired") return refused(sessionExpiredMessage);
  if (!session || !contextHasPermission(session, "quote:approve"))
    return refused("common.selfApproval.error.notPermitted");
  const reason = Reason.safeParse(input.reason);
  if (!reason.success) return refused("common.selfApproval.error.reason");
  const parsed = ChannelPolicyCommandSchema.safeParse({
    action: "approve",
    id: input.id,
    expectedRowVersion: input.expectedRowVersion,
    reason: reason.data,
    approvalEvidence: input.approvalEvidence,
    selfApproval: true,
  });
  if (!parsed.success) return refused("common.selfApproval.error.evidence");
  try {
    await new DatabaseChannelPolicyRepository(getServiceDatabase()).command({
      command: parsed.data,
      actor: { kind: "user", id: session.userId },
      requestId: crypto.randomUUID(),
      now: new Date().toISOString(),
      selfApproval: { reason: reason.data },
    });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/internal/channel-policy");
  revalidatePath("/internal/owner");
  revalidatePath("/buy");
  revalidatePath("/partner/registrations");
  return { ok: true };
}
