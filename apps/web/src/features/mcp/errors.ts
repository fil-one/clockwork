// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import { failure } from "@/src/features/internal-ops/contracts/action-result";

import { McpToolError } from "./tool";

export interface McpToolFailure {
  code: string;
  message: string;
  fields?: unknown;
  /** A refusal is the app saying no; a failure is something going wrong. */
  outcome: "refused" | "failed";
}

const recentAuthentication = (origin: string) =>
  `This needs a fresh MFA check, so it can only be done in the app: ${origin}/internal`;

/** One plain sentence for the codes a person can act on. */
function explain(code: string, origin: string): string | undefined {
  if (/FORBIDDEN$|^forbidden$|NOT_PERMITTED|PERMISSION_REQUIRED/u.test(code))
    return "Your role does not allow this. Ask a commerce administrator if you need it.";
  if (/RECENT_AUTH|RECENT_SIGN_IN/u.test(code))
    return recentAuthentication(origin);
  if (/MFA_REQUIRED$|^mfa_required$/u.test(code))
    return "Your account has no verified authenticator. Sign in to the app and set one up.";
  if (/DEMO_UNAVAILABLE$|^demo_unavailable$/u.test(code))
    return "The demo keeps no real records.";
  if (/NOT_CONFIGURED$|^not_configured$/u.test(code))
    return "Sending for signature is not set up on this deployment.";
  if (/APPROVAL_REQUIRED$/u.test(code))
    return "It needs approval from someone other than the preparer, on its page in the app, before it can be sent.";
  if (
    /VERSION_CONFLICT$|^conflict$|IDEMPOTENCY_CONFLICT$|REQUEST_CHANGED$/u.test(
      code,
    )
  )
    return "It changed since you read it. Read it again and retry with the new version.";
  if (/NOT_FOUND$|^not_found$/u.test(code))
    return "Not found, or not visible to you.";
  if (
    /^(INVALID_INPUT|invalid_value|required|invalid_email|too_long)$/u.test(
      code,
    )
  )
    return "Some values are not valid; see fields.";
  if (/^(reminder_cooldown|CONTRACT_REMINDER_TOO_SOON)$/u.test(code))
    return "A reminder went out recently. Try again later.";
  if (/^(busy|DOCUMENT_BUSY)$|LEASE_LOST$|_BUSY$/u.test(code))
    return "Another change is in progress. Try again in a moment.";
  if (code === "READ_ONLY_TOKEN")
    return "This token is read-only. Create a read_write token on your Settings page to make changes.";
  return undefined;
}

/** What a tool reports when it does not complete. */
export function toolFailure(error: unknown, origin: string): McpToolFailure {
  if (error instanceof McpToolError)
    return {
      code: error.code,
      message: error.detail ?? explain(error.code, origin) ?? error.code,
      ...(error.fields ? { fields: error.fields } : {}),
      outcome: "refused",
    };
  if (
    error instanceof Error &&
    error.message === "Sensitive action requires recent authentication"
  )
    return {
      code: "RECENT_AUTH_REQUIRED",
      message: recentAuthentication(origin),
      outcome: "refused",
    };
  if (error instanceof Error && error.name === "StaffPermissionError")
    return {
      code: "FORBIDDEN",
      message: explain("FORBIDDEN", origin) ?? "",
      outcome: "refused",
    };
  const mapped = failure(error);
  if (mapped.code === "UNEXPECTED") {
    // i18n-exempt: server log for an unexpected failure, never shown to readers
    console.error("MCP tool failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
    return {
      code: "UNEXPECTED",
      message: "Something went wrong on the server. Try again, or use the app.",
      outcome: "failed",
    };
  }
  return {
    code: mapped.code,
    message: explain(mapped.code, origin) ?? mapped.code,
    ...(mapped.fields ? { fields: mapped.fields } : {}),
    outcome: "refused",
  };
}
