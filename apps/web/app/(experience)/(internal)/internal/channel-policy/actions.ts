"use server";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { DemoCommercialPolicyRepository } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { revalidatePath } from "next/cache";
import { ChannelPolicyCommandSchema } from "@clockwork/domain/core";
import { DatabaseChannelPolicyRepository } from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
function field(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
export async function changeChannelPolicy(
  _previous: string,
  data: FormData,
): Promise<string> {
  const session = await requireRecentAuthentication();
  if (
    (!session.providerBacked && !demoDeployIdentityEnabled(process.env)) ||
    !session.isInternalStaff ||
    !session.mfaVerified ||
    !session.roles.includes("finance_approver") ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator
  )
    return "Use a directly authenticated finance session with current MFA to change policy.";
  const action = field(data, "action");
  const terms = {
    version: Number(field(data, "version")),
    effectiveFrom: field(data, "effectiveFrom"),
    selfServeThresholdTb: Number(field(data, "selfServeThresholdTb")),
    defaultProtectionDays: Number(field(data, "defaultProtectionDays")),
    maximumProtectionDays: Number(field(data, "maximumProtectionDays")),
    extensionDays: Number(field(data, "extensionDays")),
    maximumExtensions: Number(field(data, "maximumExtensions")),
    sourceEvidence: field(data, "sourceEvidence"),
  };
  const parsed = ChannelPolicyCommandSchema.safeParse(
    action === "create"
      ? { action, terms }
      : action === "save"
        ? {
            action,
            terms,
            id: field(data, "id"),
            expectedRowVersion: Number(field(data, "expectedRowVersion")),
          }
        : {
            action,
            id: field(data, "id"),
            expectedRowVersion: Number(field(data, "expectedRowVersion")),
            reason: field(data, "reason"),
            ...(action === "approve"
              ? { approvalEvidence: field(data, "approvalEvidence") }
              : {}),
          },
  );
  if (!parsed.success)
    return "Check the dates, whole-day limits, version, and evidence. Default protection must fit the maximum window.";
  try {
    const input = {
      command: parsed.data,
      userId: session.userId,
      requestId: crypto.randomUUID(),
      now: new Date().toISOString(),
    };
    if (demoDeployIdentityEnabled(process.env))
      await new DemoCommercialPolicyRepository().commandChannel(input);
    else
      await new DatabaseChannelPolicyRepository(getServiceDatabase()).command({
        command: parsed.data,
        actor: { kind: "user", id: session.userId },
        requestId: crypto.randomUUID(),
        now: new Date().toISOString(),
      });
    revalidatePath("/internal/channel-policy");
    revalidatePath("/buy");
    revalidatePath("/partner/registrations");
    return action === "approve"
      ? "Policy approved. New requests use it from its effective date; existing registrations retain their snapshot."
      : action === "reject"
        ? "Returned to draft with the decision reason."
        : action === "propose"
          ? "Proposed for a different finance approver. Content is frozen during review."
          : "Draft saved.";
  } catch (error) {
    const messages: Record<string, string> = {
      CHANNEL_POLICY_DISTINCT_APPROVER_REQUIRED:
        "A finance approver who neither created, edited, nor proposed this version must decide it.",
      CHANNEL_POLICY_VERSION_CONFLICT:
        "This version changed. Refresh before retrying.",
      CHANNEL_POLICY_BACKDATED_APPROVAL:
        "The effective date is now in the past. Return the draft for a current or future date.",
      CHANNEL_POLICY_IMMUTABLE:
        "Approved policies are immutable. Create a new version.",
      CHANNEL_POLICY_FINANCE_REQUIRED:
        "Your persisted finance role or MFA enrollment does not permit this action.",
    };
    return (
      (error instanceof Error ? messages[error.message] : undefined) ??
      "The policy could not be saved. Refresh and check that its version and approved effective date are unique."
    );
  }
}
