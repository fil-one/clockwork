"use server";

import { revalidatePath } from "next/cache";
import { CatalogMappingSchema, DatabaseCatalogAdmin } from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

export async function saveCatalogMapping(
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
    return "Mapping changes require a directly authenticated operator or finance approver with recent MFA.";
  const parsed = CatalogMappingSchema.safeParse({
    rateCardId: data.get("rateCardId"),
    providerSku: data.get("providerSku"),
    providerRegion: data.get("providerRegion"),
    meterId: data.get("meterId"),
    sourceEvidence: data.get("sourceEvidence"),
    reason: data.get("reason"),
    expectedRowVersion: Number(data.get("expectedRowVersion")),
  });
  if (!parsed.success)
    return "Check the provider SKU, region, meter, evidence reference, and reason.";
  try {
    await new DatabaseCatalogAdmin(getServiceDatabase()).save({
      command: parsed.data,
      actor: { kind: "user", id: session.userId },
      requestId: `catalog:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/catalog");
    revalidatePath("/internal/price-books");
    return "Draft mapping saved. Provider qualification and price-book approval remain required.";
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_VERSION_CONFLICT")
      return "The price book changed. Refresh and review the latest draft before saving again.";
    if (error instanceof Error && error.message === "CATALOG_DRAFT_FROZEN")
      return "This mapping is frozen. Reject the pending proposal or create a new draft version.";
    return "The mapping could not be saved. Refresh and check your current authority and the source evidence.";
  }
}
