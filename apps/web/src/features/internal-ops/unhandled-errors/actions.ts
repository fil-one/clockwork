"use server";

import { revalidatePath } from "next/cache";

import { hasPermission } from "@clockwork/contracts";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { requireRecentAuthentication } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { recordUnhandledErrorDecision } from "./decision-store";
import { decisionReasonLimits, isContainmentReference } from "./model";
import { decideDemoRuntimeFailure } from "../demo-operator-state";

export interface UnhandledErrorDecisionResult {
  ok: boolean;
  code?: string;
  /** Sequence number the record took against the failure's audit event. */
  recordVersion?: number;
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Records one operator decision about one unhandled runtime failure.
 *
 * `system:operate` is re-checked here against freshly read session roles rather
 * than inherited from the page that rendered the control, and the anchor is
 * re-read inside the transaction, so a stale page cannot record a decision
 * against an audit row that is not a runtime failure.
 *
 * The decision changes no runtime state, and says so on the page rather than
 * implying otherwise. Containment of a provider capability is the emergency
 * state on the external gate register; retry and abandonment of exhausted work
 * are on the recovery queue. This surface records that a decision was taken,
 * by whom, why, and against which failure -- which is step 1 of
 * `docs/operations/unhandled-errors.md` and the only step of it that had no
 * durable home.
 */
export async function decideUnhandledError(
  formData: FormData,
): Promise<UnhandledErrorDecisionResult> {
  const auditEventId = text(formData, "auditEventId");
  const decision = text(formData, "decision");
  const reason = text(formData, "reason");
  const containmentReference = text(formData, "containmentReference");

  if (
    !uuid.test(auditEventId) ||
    (decision !== "contain" && decision !== "release")
  )
    return { ok: false, code: "UNHANDLED_ERROR_INVALID" };
  // Two bounds, two codes. One code for both meant a 501-character reason was
  // refused with "Give a reason of at least 8 characters" -- a message that
  // tells the operator the opposite of what is wrong, mid-incident.
  if (reason.length < decisionReasonLimits.min)
    return { ok: false, code: "UNHANDLED_ERROR_REASON_REQUIRED" };
  if (reason.length > decisionReasonLimits.max)
    return { ok: false, code: "UNHANDLED_ERROR_REASON_TOO_LONG" };
  if (containmentReference && !isContainmentReference(containmentReference))
    return { ok: false, code: "UNHANDLED_ERROR_EVIDENCE_INVALID" };

  const demoEnabled = demoDeployIdentityEnabled(process.env);
  const database = getOptionalServiceDatabase();
  if (!database && !demoEnabled)
    return { ok: false, code: "UNHANDLED_ERROR_UNAVAILABLE" };

  let session;
  try {
    session = await requireRecentAuthentication();
  } catch {
    return { ok: false, code: "UNHANDLED_ERROR_RECENT_AUTH_REQUIRED" };
  }

  const permitted =
    session.isInternalStaff &&
    session.roles.some((role) => hasPermission(role, "system:operate"));
  if (!permitted) return { ok: false, code: "UNHANDLED_ERROR_FORBIDDEN" };

  if (demoEnabled && !database) {
    try {
      const recorded = await decideDemoRuntimeFailure({
        auditEventId,
        decision,
        reason,
        ...(containmentReference ? { containmentReference } : {}),
        actorId: session.userId,
      });
      revalidatePath("/internal/unhandled-errors");
      return { ok: true, recordVersion: recorded.recordVersion };
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof Error &&
          error.message === "UNHANDLED_ERROR_NOT_FOUND"
            ? "UNHANDLED_ERROR_NOT_FOUND"
            : "UNHANDLED_ERROR_FAILED",
      };
    }
  }
  if (!database) return { ok: false, code: "UNHANDLED_ERROR_UNAVAILABLE" };

  try {
    const recorded = await recordUnhandledErrorDecision(database, {
      auditEventId,
      decision,
      reason,
      ...(containmentReference ? { containmentReference } : {}),
      actor: { kind: "user", id: session.userId },
      requestId: `experience:unhandled-errors:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/unhandled-errors");
    return { ok: true, recordVersion: recorded.recordVersion };
  } catch (error) {
    // Only the anchor miss is named. Everything else stays generic so a
    // database detail cannot reach the page.
    return {
      ok: false,
      code:
        error instanceof Error && error.message === "UNHANDLED_ERROR_NOT_FOUND"
          ? "UNHANDLED_ERROR_NOT_FOUND"
          : "UNHANDLED_ERROR_FAILED",
    };
  }
}
