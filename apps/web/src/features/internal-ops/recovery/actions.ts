"use server";

import { DatabaseSystemRecoveryCommandExecutor } from "@clockwork/db";
import type { DeadLetterSource } from "@clockwork/db";
import { revalidatePath } from "next/cache";

import {
  getCommerceSession,
  requireRecentAuthentication,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import { redriveRetriedWork } from "./redrive";

export interface RecoveryDecisionResult {
  ok: boolean;
  code?: string;
  redriveSubmitted?: boolean;
}

const sources: readonly DeadLetterSource[] = [
  "outbox_message",
  "provisioning_attempt",
  "workflow_run",
];

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Applies one operator decision to one stopped record.
 *
 * Authorization is re-checked in the database executor against freshly read
 * roles, so a stale page cannot carry an expired permission into a decision.
 */
export async function decideDeadLetterOperation(
  formData: FormData,
): Promise<RecoveryDecisionResult> {
  const source = text(formData, "source") as DeadLetterSource;
  const id = text(formData, "id");
  const action = text(formData, "action");
  const reason = text(formData, "reason");
  if (
    !sources.includes(source) ||
    !id ||
    (action !== "retry" && action !== "abandon")
  )
    return { ok: false, code: "SYSTEM_RECOVERY_INVALID" };
  if (reason.length < 8)
    return { ok: false, code: "SYSTEM_RECOVERY_REASON_REQUIRED" };

  const database = getOptionalServiceDatabase();
  if (!database) return { ok: false, code: "SYSTEM_RECOVERY_UNAVAILABLE" };

  try {
    await requireRecentAuthentication();
  } catch {
    return { ok: false, code: "SYSTEM_RECOVERY_RECENT_AUTH_REQUIRED" };
  }
  const session = await getCommerceSession();
  const requestId = `experience:recovery:${crypto.randomUUID()}`;
  const result = await new DatabaseSystemRecoveryCommandExecutor({
    database,
  }).execute({
    action,
    source,
    id,
    reason,
    actor: { kind: "user", id: session.userId },
    mfaVerified: session.mfaVerified,
    recentAuthenticationVerified: session.recentAuthenticationVerified,
    authorizationCreatedAt: new Date().toISOString(),
    idempotencyKey: `recovery:${action}:${source}:${id}`,
    requestId,
  });
  if (!result.ok) return { ok: false, code: result.code };

  revalidatePath("/internal/recovery");
  if (action === "abandon") return { ok: true };

  // The decision and its audit row are already committed. A redrive that was
  // not submitted is reported so the operator repeats the submission rather
  // than the decision.
  const redrive = await redriveRetriedWork(database, {
    source,
    id,
    requestedBy: session.userId,
    reason,
    requestId: `${requestId}:redrive`,
  });
  if (redrive.status === "unavailable")
    return { ok: true, code: "SYSTEM_RECOVERY_REDRIVE_NOT_SUBMITTED" };
  if (redrive.status === "unmapped")
    return { ok: true, code: "SYSTEM_RECOVERY_REDRIVE_UNMAPPED" };
  return { ok: true, redriveSubmitted: redrive.status === "submitted" };
}
