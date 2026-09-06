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
  _previous: string,
  data: FormData,
): Promise<string> {
  const session = await requireRecentAuthentication();
  if (
    !session.providerBacked ||
    !session.isInternalStaff ||
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator
  )
    return "Capability changes require a directly authenticated staff session with MFA.";
  const parsed = ControlSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success)
    return "Check the decision reason, evidence, and current version, then try again.";
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
    else return "Select a pending activation request.";
    revalidatePath("/internal/capabilities");
    return value.action === "propose"
      ? "Activation requested. A distinct approver must review it within 24 hours."
      : value.action === "disable"
        ? "Capability disabled. Earlier pending activation requests were canceled."
        : "Decision recorded.";
  } catch (error) {
    const messages: Record<string, string> = {
      CAPABILITY_AUTHORITY_REQUIRED:
        "Your current staff role cannot perform this action.",
      CAPABILITY_DISTINCT_APPROVER_REQUIRED:
        "A different authorized staff member must approve this request.",
      CAPABILITY_VERSION_CONFLICT:
        "The capability changed. Refresh and review its latest state before trying again.",
      CAPABILITY_REQUEST_EXPIRED:
        "This request expired. Reject it and request activation again with current evidence.",
      CAPABILITY_REQUEST_PENDING:
        "An activation request is already awaiting review.",
      CAPABILITY_REQUEST_NOT_PENDING:
        "This request has already been decided or canceled. Refresh to see the latest state.",
      CAPABILITY_ALREADY_ENABLED: "This capability is already enabled.",
      CAPABILITY_REASON_REQUIRED:
        "Provide a decision reason of at least eight characters.",
    };
    return error instanceof Error && messages[error.message]
      ? (messages[error.message] ?? "The change could not be recorded.")
      : "The change could not be recorded. Check the evidence reference and refresh before retrying.";
  }
}
