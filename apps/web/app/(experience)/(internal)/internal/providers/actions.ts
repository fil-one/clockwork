"use server";
import { revalidatePath } from "next/cache";
import {
  DatabaseProviderReferenceAdmin,
  ProviderReferenceCommandSchema,
} from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import type { MessageId } from "@/src/i18n";

/**
 * The outcome as a message ID; the form renders it in the reader's language.
 * An empty string is the form's initial state.
 */
export type ProviderReferenceResult = MessageId | "";

export async function saveProviderReference(
  _previous: ProviderReferenceResult,
  data: FormData,
): Promise<ProviderReferenceResult> {
  const session = await requireRecentAuthentication();
  if (
    !session.providerBacked ||
    !session.isInternalStaff ||
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator ||
    !session.roles.some(
      (role) => role === "internal_operator" || role === "finance_approver",
    )
  )
    return "adminGovernance.providers.result.directSessionRequired";
  const parsed = ProviderReferenceCommandSchema.safeParse({
    provider: data.get("provider"),
    secretReference: data.get("secretReference"),
    secretVersion: data.get("secretVersion"),
    rotatedAt: data.get("rotatedAt"),
    owner: data.get("owner"),
    reviewIntervalDays: Number(data.get("reviewIntervalDays")),
    sourceEvidence: data.get("sourceEvidence"),
    expectedRowVersion: Number(data.get("expectedRowVersion")),
    reason: data.get("reason"),
  });
  if (!parsed.success) return "adminGovernance.providers.result.invalid";
  try {
    await new DatabaseProviderReferenceAdmin(getServiceDatabase()).save({
      command: parsed.data,
      actor: { kind: "user", id: session.userId },
      requestId: `provider-reference:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/providers");
    return "adminGovernance.providers.result.saved";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PROVIDER_REFERENCE_VERSION_CONFLICT"
    )
      return "adminGovernance.providers.result.conflict";
    if (
      error instanceof Error &&
      error.message === "PROVIDER_REFERENCE_FUTURE_ROTATION"
    )
      return "adminGovernance.providers.result.futureRotation";
    return "adminGovernance.providers.result.failed";
  }
}
