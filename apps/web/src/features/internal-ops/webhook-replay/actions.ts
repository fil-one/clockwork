"use server";

import { DatabaseCoreFinanceService } from "@clockwork/api";
import { hasPermission } from "@clockwork/contracts";
import { revalidatePath } from "next/cache";

import {
  getCommerceSession,
  requireRecentAuthentication,
} from "@/src/auth/session";
import {
  getOptionalRuntimeDatabase,
  getOptionalServiceDatabase,
} from "@/src/db/service";
import { composedTaxProvider } from "@/src/providers/tax";

export interface WebhookReplayOutcome {
  ok: boolean;
  /** True only when this call started a replay, false when one was already in flight. */
  started?: boolean;
  workflowRunId?: string;
  code?: string;
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

/** The core service carries a stable code on the errors it raises. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "NOT_FOUND"
  );
}

/**
 * Replays one verified provider callback.
 *
 * The command is idempotent: an event whose replay is pending or running comes
 * back untouched. That case is reported as itself rather than as a second
 * success, because telling an operator a replay started when it did not is how
 * one incident gets worked twice.
 *
 * `system:operate` is re-checked here against freshly read session roles rather
 * than inherited from the page that rendered the button, and the service reads
 * only the stored verified row, so an unknown event id resolves to NOT_FOUND
 * instead of manufacturing a callback.
 */
export async function replayWebhookEvent(
  formData: FormData,
): Promise<WebhookReplayOutcome> {
  const provider = text(formData, "provider");
  const providerEventId = text(formData, "providerEventId");
  const reason = text(formData, "reason");
  if (!provider || !providerEventId)
    return { ok: false, code: "WEBHOOK_REPLAY_INVALID" };
  if (reason.length < 8)
    return { ok: false, code: "WEBHOOK_REPLAY_REASON_REQUIRED" };

  const database = getOptionalRuntimeDatabase();
  const pricingDatabase = getOptionalServiceDatabase();
  const authorizationSecret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!database || !pricingDatabase || !authorizationSecret)
    return { ok: false, code: "WEBHOOK_REPLAY_UNAVAILABLE" };

  try {
    await requireRecentAuthentication();
  } catch {
    return { ok: false, code: "WEBHOOK_REPLAY_RECENT_AUTH_REQUIRED" };
  }

  const session = await getCommerceSession();
  const permitted =
    session.isInternalStaff &&
    session.roles.some((role) => hasPermission(role, "system:operate"));
  if (!permitted) return { ok: false, code: "WEBHOOK_REPLAY_FORBIDDEN" };

  try {
    // Replay moves no money and determines no tax. `requiredTaxProvider()`
    // threw `TAX_PROVIDER_NOT_CONFIGURED:EXT-TAX-01` while the argument list
    // was still being built, so an unwired EXT-TAX-01 refused every replay --
    // including ones that could never reach a tax determination. That is the
    // same defect the API composition carried (P0-61's over-correction).
    // `composedTaxProvider()` supplies a port that refuses `calculate` and
    // `validateTaxId` instead of refusing to exist, which keeps the refusal on
    // the two commands that can write a `tax_minor` and off this one.
    //
    // The repository persists the operator reason and queues only a trusted
    // workflow-run reference. The worker reloads the signature-verified payload
    // from the service database; neither this action nor Trigger receives bytes
    // an operator could amend.
    const result = await new DatabaseCoreFinanceService({
      database,
      pricingDatabase,
      authorizationSecret,
      tax: composedTaxProvider(),
    }).replay({
      provider,
      eventId: providerEventId,
      actor: { kind: "user", id: session.userId },
      reason,
      requestId: `experience:webhook-replay:${crypto.randomUUID()}`,
    });
    revalidatePath("/internal/webhook-replay");
    return {
      ok: true,
      started: result.replayed,
      workflowRunId: result.workflowRunId,
      ...(result.replayed ? {} : { code: "WEBHOOK_REPLAY_ALREADY_RUNNING" }),
    };
  } catch (error) {
    // An unknown event id is named. Everything else stays generic so a provider
    // or database detail cannot reach the page.
    return {
      ok: false,
      code: isNotFound(error)
        ? "WEBHOOK_REPLAY_EVENT_NOT_FOUND"
        : "WEBHOOK_REPLAY_FAILED",
    };
  }
}
