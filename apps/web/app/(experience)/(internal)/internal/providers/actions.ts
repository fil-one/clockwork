"use server";
import { revalidatePath } from "next/cache";
import {
  DatabaseProviderReferenceAdmin,
  ProviderReferenceCommandSchema,
} from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

export async function saveProviderReference(
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
    session.authenticationProviderImpersonator ||
    !session.roles.some(
      (role) => role === "internal_operator" || role === "finance_approver",
    )
  )
    return "Changes require a directly authenticated operator or finance approver with recent MFA.";
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
  if (!parsed.success)
    return "Check all fields. Use a secret-manager reference, an ISO UTC rotation timestamp, a review interval of 1–730 days, and an evidence reference.";
  try {
    await new DatabaseProviderReferenceAdmin(getServiceDatabase()).save({
      command: parsed.data,
      actor: { kind: "user", id: session.userId },
      requestId: `provider-reference:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/providers");
    return "Reference saved. Deployed credentials and provider qualification are unchanged.";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "PROVIDER_REFERENCE_VERSION_CONFLICT"
    )
      return "This reference changed while you were editing. Refresh and review the latest version before saving again.";
    if (
      error instanceof Error &&
      error.message === "PROVIDER_REFERENCE_FUTURE_ROTATION"
    )
      return "Rotation must already have occurred. Enter its actual timestamp, not a planned future date.";
    return "The reference could not be saved. Refresh and check your current authority and evidence.";
  }
}
