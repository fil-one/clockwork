"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { uuidV7 } from "@clockwork/contracts";
import {
  DatabaseSystemCapabilityAdmin,
  systemCapabilityKeys,
} from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import type { MessageId } from "@/src/i18n";

/**
 * The outcome as a message ID; the form renders it in the reader's language.
 * An empty string is the form's initial state.
 */
export type CapabilityActionResult = MessageId | "";

const ControlSchema = z.object({
  capabilityKey: z.enum(systemCapabilityKeys),
  expectedRowVersion: z.coerce.number().int().positive(),
  action: z.enum(["propose", "approve", "reject", "disable"]),
  reason: z.string().trim().min(8).max(2000),
  recovery: z.enum(["true", "false"]),
  evidenceReference: z.string().max(2000).optional(),
  proposalId: z.uuid().optional(),
});

export async function changeCapability(
  _previous: CapabilityActionResult,
  data: FormData,
): Promise<CapabilityActionResult> {
  const session = await requireRecentAuthentication();
  if (
    !session.providerBacked ||
    !session.isInternalStaff ||
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator
  )
    return "adminGovernance.capabilities.result.directSessionRequired";
  const parsed = ControlSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return "adminGovernance.capabilities.result.invalid";
  const value = parsed.data;
  const base = {
    capabilityKey: value.capabilityKey,
    expectedRowVersion: value.expectedRowVersion,
    actor: { kind: "user" as const, id: session.userId },
    reason: value.reason,
    now: new Date(),
    requestId: `capability:${uuidV7()}`,
  };
  const service = new DatabaseSystemCapabilityAdmin(getServiceDatabase());
  try {
    if (value.action === "propose")
      await service.propose({
        ...base,
        enableRecovery: value.recovery === "true",
        evidenceReference: value.evidenceReference ?? "",
      });
    else if (value.action === "disable")
      await service.disable({
        ...base,
        disableRecovery: value.recovery === "true",
      });
    else if (value.proposalId)
      await service.decide({
        ...base,
        proposalId: value.proposalId,
        approve: value.action === "approve",
      });
    else return "adminGovernance.capabilities.result.selectPending";
    revalidatePath("/internal/capabilities");
    return value.action === "propose"
      ? "adminGovernance.capabilities.result.proposed"
      : value.action === "disable"
        ? "adminGovernance.capabilities.result.disabled"
        : "adminGovernance.capabilities.result.decided";
  } catch (error) {
    const messages: Readonly<Record<string, MessageId>> = {
      CAPABILITY_AUTHORITY_REQUIRED:
        "adminGovernance.capabilities.error.authority",
      CAPABILITY_DISTINCT_APPROVER_REQUIRED:
        "adminGovernance.capabilities.error.distinctApprover",
      CAPABILITY_VERSION_CONFLICT:
        "adminGovernance.capabilities.error.versionConflict",
      CAPABILITY_REQUEST_EXPIRED: "adminGovernance.capabilities.error.expired",
      CAPABILITY_REQUEST_PENDING: "adminGovernance.capabilities.error.pending",
      CAPABILITY_REQUEST_NOT_PENDING:
        "adminGovernance.capabilities.error.notPending",
      CAPABILITY_ALREADY_ENABLED:
        "adminGovernance.capabilities.error.alreadyEnabled",
      CAPABILITY_REASON_REQUIRED:
        "adminGovernance.capabilities.error.reasonRequired",
    };
    return (
      (error instanceof Error && Object.hasOwn(messages, error.message)
        ? messages[error.message]
        : undefined) ?? "adminGovernance.capabilities.error.generic"
    );
  }
}
