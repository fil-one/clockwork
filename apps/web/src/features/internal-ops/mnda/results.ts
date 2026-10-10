import type { ZodError } from "zod";
import type {
  MndaErrorCode,
  MndaFieldError,
  MndaResult,
} from "@clockwork/contracts";

/** Server error messages and the code, and field, the workspace shows. */
const known: Record<string, { code: MndaErrorCode; field?: string }> = {
  MNDA_FORBIDDEN: { code: "forbidden" },
  MNDA_DEMO_UNAVAILABLE: { code: "demo_unavailable" },
  MNDA_MFA_REQUIRED: { code: "mfa_required" },
  MNDA_NOT_CONFIGURED: { code: "not_configured" },
  MNDA_NOT_FOUND: { code: "not_found" },
  MNDA_ARTIFACT_NOT_FOUND: { code: "not_found" },
  MNDA_BUSY: { code: "busy" },
  MNDA_LEASE_LOST: { code: "busy" },
  MNDA_REMINDER_TOO_SOON: { code: "reminder_cooldown" },
  MNDA_NOT_PENDING: { code: "not_pending" },
  MNDA_VOID_REQUIRED: { code: "not_pending" },
  MNDA_IDEMPOTENCY_CONFLICT: { code: "conflict" },
  MNDA_SETTINGS_CHANGED: { code: "settings_changed" },
  MNDA_SETTINGS_CONFLICT: { code: "settings_conflict" },
  MNDA_NOT_OWNER: { code: "not_owner" },
  MNDA_NOT_VOIDABLE: { code: "not_voidable" },
  MNDA_DISTINCT_SIGNERS_REQUIRED: {
    code: "same_as_countersigner",
    field: "signerEmail",
  },
  MNDA_SIGNER_REQUIRED: {
    code: "countersigner_unavailable",
    field: "countersignerId",
  },
  MNDA_SIGNER_CHANGED: {
    code: "countersigner_unavailable",
    field: "countersignerId",
  },
  MNDA_DEFAULT_MUST_BE_ACTIVE: { code: "invalid_value", field: "isDefault" },
  MNDA_SIGNER_STARTED: { code: "signer_started" },
  MNDA_NOT_CORRECTABLE: { code: "not_correctable" },
  MNDA_ALREADY_COMPLETED: { code: "already_completed" },
};

function fieldCode(issue: ZodError["issues"][number]): MndaErrorCode {
  switch (issue.code) {
    case "too_small":
    case "invalid_type":
      return "required";
    case "too_big":
      return "too_long";
    case "invalid_format":
      return issue.format === "email"
        ? "invalid_email"
        : issue.format === "date"
          ? "invalid_date"
          : "invalid_characters";
    case "custom":
      return (issue.params as { mnda?: string } | undefined)?.mnda ===
        "reserved_characters"
        ? "invalid_characters"
        : "required";
    default:
      return "invalid_value";
  }
}

/** One message per field, the first problem found. */
export function mndaInvalid(error: ZodError): MndaResult<never> {
  const fields: MndaFieldError[] = [];
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    if (field && !fields.some((f) => f.field === field))
      fields.push({ field, code: fieldCode(issue) });
  }
  return { ok: false, code: fields[0]?.code ?? "invalid_value", fields };
}

/** Maps a thrown error to a stable code. Provider bodies are never returned. */
export function mndaFailure(error: unknown): MndaResult<never> {
  const message = error instanceof Error ? error.message : "";
  const match = known[message];
  if (match)
    return {
      ok: false,
      code: match.code,
      ...(match.field
        ? { fields: [{ field: match.field, code: match.code }] }
        : {}),
    };
  if (
    message.startsWith("SIGNWELL_") ||
    (error instanceof Error && error.name === "AbortError")
  )
    return { ok: false, code: "provider_failed" };
  // i18n-exempt: server log for an unexpected failure, never shown to readers
  console.error("MNDA action failed", {
    error: error instanceof Error ? error.name : typeof error,
    message: message.slice(0, 120),
  });
  return { ok: false, code: "unexpected" };
}
