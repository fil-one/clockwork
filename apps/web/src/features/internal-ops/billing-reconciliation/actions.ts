"use server";

import { revalidatePath } from "next/cache";

import { hasPermission } from "@clockwork/contracts";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { recordVarianceDisposition } from "./disposition-store";
import { clearingPeriodPattern, isVarianceClassification } from "./model";
import { classifyDemoReconciliationVariance } from "../demo-operator-state";

export interface VarianceDispositionResult {
  ok: boolean;
  code?: string;
  /** True when the recorded classification still blocks the close. */
  blocksClose?: boolean;
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const evidencePattern = /^[A-Za-z0-9._:\-/]{1,120}$/;

const knownFailures = new Set([
  "RECONCILIATION_CASE_NOT_FOUND",
  "RECONCILIATION_VERSION_CONFLICT",
  "RECONCILIATION_REASON_REQUIRED",
]);

/**
 * Classifies one open reconciliation variance.
 *
 * `billing:approve` is re-checked here against freshly read session roles
 * rather than inherited from the page, the case is re-read inside the
 * transaction under its own row lock, and the version the page was rendered
 * with is the CAS predicate -- so a disposition written against a stale view of
 * the case is refused rather than silently overwriting a newer one.
 */
export async function classifyReconciliationVariance(
  formData: FormData,
): Promise<VarianceDispositionResult> {
  const caseId = text(formData, "caseId");
  const expectedRowVersion = Number.parseInt(
    text(formData, "expectedRowVersion"),
    10,
  );
  const classification = text(formData, "classification");
  const reason = text(formData, "reason");
  const expectedClearingPeriod = text(formData, "expectedClearingPeriod");
  const evidenceReference = text(formData, "evidenceReference");

  if (
    !uuid.test(caseId) ||
    !Number.isSafeInteger(expectedRowVersion) ||
    expectedRowVersion < 1
  )
    return { ok: false, code: "RECONCILIATION_INVALID" };
  if (!isVarianceClassification(classification))
    return { ok: false, code: "RECONCILIATION_CLASSIFICATION_INVALID" };
  if (reason.length < 8 || reason.length > 500)
    return { ok: false, code: "RECONCILIATION_REASON_REQUIRED" };
  if (
    expectedClearingPeriod &&
    !clearingPeriodPattern.test(expectedClearingPeriod)
  )
    return { ok: false, code: "RECONCILIATION_CLEARING_PERIOD_INVALID" };
  if (evidenceReference && !evidencePattern.test(evidenceReference))
    return { ok: false, code: "RECONCILIATION_EVIDENCE_INVALID" };

  const demoEnabled = demoDeployIdentityEnabled(process.env);
  const database = getOptionalServiceDatabase();
  if (!database && !demoEnabled)
    return { ok: false, code: "RECONCILIATION_UNAVAILABLE" };

  let session;
  try {
    session = await requireRecentAuthentication();
  } catch {
    return { ok: false, code: "RECONCILIATION_RECENT_AUTH_REQUIRED" };
  }

  // Two roles legitimately dispose of a variance and neither holds the other's
  // permission: the runbook gives the close to finance (`billing:approve`) and
  // the workflow recovery around it to commerce operations (`system:operate`).
  // Requiring one of them would refuse the other, which is a control blocking
  // legitimate work rather than a control.
  const permitted =
    session.isInternalStaff &&
    session.roles.some(
      (role) =>
        hasPermission(role, "billing:approve") ||
        hasPermission(role, "system:operate"),
    );
  if (!permitted) return { ok: false, code: "RECONCILIATION_FORBIDDEN" };

  if (demoEnabled && !database) {
    try {
      const recorded = await classifyDemoReconciliationVariance({
        caseId,
        expectedRowVersion,
        classification,
        reason,
        ...(expectedClearingPeriod ? { expectedClearingPeriod } : {}),
        ...(evidenceReference ? { evidenceReference } : {}),
        actorId: session.userId,
      });
      revalidatePath("/internal/billing-reconciliation");
      return { ok: true, blocksClose: recorded.blocksClose };
    } catch (error) {
      const code =
        error instanceof Error && knownFailures.has(error.message)
          ? error.message
          : "RECONCILIATION_FAILED";
      return { ok: false, code };
    }
  }
  if (!database) return { ok: false, code: "RECONCILIATION_UNAVAILABLE" };

  try {
    const recorded = await recordVarianceDisposition(database, {
      caseId,
      expectedRowVersion,
      classification,
      reason,
      ...(expectedClearingPeriod ? { expectedClearingPeriod } : {}),
      ...(evidenceReference ? { evidenceReference } : {}),
      actor: { kind: "user", id: session.userId },
      requestId: `experience:billing-reconciliation:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/billing-reconciliation");
    return { ok: true, blocksClose: recorded.blocksClose };
  } catch (error) {
    const code =
      error instanceof Error && knownFailures.has(error.message)
        ? error.message
        : "RECONCILIATION_FAILED";
    return { ok: false, code };
  }
}
