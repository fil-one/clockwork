"use server";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { DemoCommercialPolicyRepository } from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { revalidatePath } from "next/cache";
import { ChannelPolicyCommandSchema } from "@clockwork/domain/core";
import { DatabaseChannelPolicyRepository } from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import type { MessageId } from "@/src/i18n";

/**
 * The outcome as a message ID; the form renders it in the reader's language.
 * An empty string is the form's initial state.
 */
export type ChannelPolicyResult = MessageId | "";

function field(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}
export async function changeChannelPolicy(
  _previous: ChannelPolicyResult,
  data: FormData,
): Promise<ChannelPolicyResult> {
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
    return "adminGovernance.channelPolicy.result.financeSessionRequired";
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
  if (!parsed.success) return "adminGovernance.channelPolicy.result.invalid";
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
      ? "adminGovernance.channelPolicy.result.approved"
      : action === "reject"
        ? "adminGovernance.channelPolicy.result.returned"
        : action === "propose"
          ? "adminGovernance.channelPolicy.result.proposed"
          : "adminGovernance.channelPolicy.result.saved";
  } catch (error) {
    const messages: Readonly<Record<string, MessageId>> = {
      CHANNEL_POLICY_DISTINCT_APPROVER_REQUIRED:
        "adminGovernance.channelPolicy.error.distinctApprover",
      CHANNEL_POLICY_VERSION_CONFLICT:
        "adminGovernance.channelPolicy.error.versionConflict",
      CHANNEL_POLICY_BACKDATED_APPROVAL:
        "adminGovernance.channelPolicy.error.backdated",
      CHANNEL_POLICY_IMMUTABLE: "adminGovernance.channelPolicy.error.immutable",
      CHANNEL_POLICY_FINANCE_REQUIRED:
        "adminGovernance.channelPolicy.error.financeRequired",
    };
    return (
      (error instanceof Error && Object.hasOwn(messages, error.message)
        ? messages[error.message]
        : undefined) ?? "adminGovernance.channelPolicy.error.generic"
    );
  }
}
