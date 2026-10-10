"use server";

import { contextHasAnyPermission } from "@clockwork/contracts";
import { revalidatePath } from "next/cache";
import { CatalogMappingSchema, DatabaseCatalogAdmin } from "@clockwork/db";
import {
  requireRecentAuthentication,
  SessionExpiredError,
  type CommerceSession,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

/**
 * What happened to a mapping save. A code, not a sentence: the form words it
 * in the reader's language, and the authority rule it reports stays here.
 */
export type CatalogMappingResult =
  | ""
  | "forbidden"
  | "expired"
  | "invalid"
  | "saved"
  | "conflict"
  | "frozen"
  | "failed";

export async function saveCatalogMapping(
  _previous: CatalogMappingResult,
  data: FormData,
): Promise<CatalogMappingResult> {
  let session: CommerceSession;
  try {
    session = await requireRecentAuthentication();
  } catch (error) {
    // An expired access token is the one refusal a reload fixes; every
    // other refusal still reaches the error boundary as before.
    if (error instanceof SessionExpiredError) return "expired";
    throw error;
  }
  if (
    !session.providerBacked ||
    !session.isInternalStaff ||
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator ||
    !contextHasAnyPermission(session, ["operations:write", "quote:approve"])
  )
    return "forbidden";
  const parsed = CatalogMappingSchema.safeParse({
    rateCardId: data.get("rateCardId"),
    providerSku: data.get("providerSku"),
    providerRegion: data.get("providerRegion"),
    meterId: data.get("meterId"),
    sourceEvidence: data.get("sourceEvidence"),
    reason: data.get("reason"),
    expectedRowVersion: Number(data.get("expectedRowVersion")),
  });
  if (!parsed.success) return "invalid";
  try {
    await new DatabaseCatalogAdmin(getServiceDatabase()).save({
      command: parsed.data,
      actor: { kind: "user", id: session.userId },
      requestId: `catalog:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/catalog");
    revalidatePath("/internal/price-books");
    return "saved";
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_VERSION_CONFLICT")
      return "conflict";
    if (error instanceof Error && error.message === "CATALOG_DRAFT_FROZEN")
      return "frozen";
    return "failed";
  }
}
