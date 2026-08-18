"use server";

import { hasPermission } from "@clockwork/contracts";
import { revalidatePath } from "next/cache";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { requireRecentAuthentication } from "@/src/auth/session";
import { decideDemoMigration } from "@/src/features/internal-ops/demo-operator-state";

import { illustrativeMigrations } from "./lifecycle-data";
import { resolveMigration } from "./lifecycle-logic";

export interface MigrationDecisionState {
  readonly ok: boolean;
  readonly code?: string;
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

export async function recordDemoMigrationDecision(
  _previous: MigrationDecisionState,
  formData: FormData,
): Promise<MigrationDecisionState> {
  if (!demoDeployIdentityEnabled(process.env))
    return { ok: false, code: "MIGRATION_DECISION_UNAVAILABLE" };
  const migrationId = text(formData, "migrationId");
  const targetAccountId = text(formData, "targetAccountId");
  const reason = text(formData, "reason");
  if (reason.length < 8 || reason.length > 500)
    return { ok: false, code: "MIGRATION_REASON_REQUIRED" };
  const record = illustrativeMigrations.find(
    (candidate) => candidate.id === migrationId,
  );
  if (!record) return { ok: false, code: "MIGRATION_RECORD_NOT_FOUND" };
  const resolution = resolveMigration(record, targetAccountId, true);
  if (!resolution.allowed || resolution.action === "blocked")
    return { ok: false, code: "MIGRATION_DECISION_INVALID" };

  let session;
  try {
    session = await requireRecentAuthentication();
  } catch {
    return { ok: false, code: "MIGRATION_RECENT_AUTH_REQUIRED" };
  }
  if (
    !session.isInternalStaff ||
    !session.roles.some((role) => hasPermission(role, "system:operate"))
  )
    return { ok: false, code: "MIGRATION_FORBIDDEN" };
  try {
    await decideDemoMigration({
      migrationId,
      action: resolution.action,
      targetAccountId: targetAccountId || null,
      reason,
      actorId: session.userId,
    });
    revalidatePath("/internal/migrations");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof Error &&
        ["MIGRATION_RECORD_NOT_FOUND", "MIGRATION_DECISION_INVALID"].includes(
          error.message,
        )
          ? error.message
          : "MIGRATION_DECISION_FAILED",
    };
  }
}
