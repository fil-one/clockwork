import type { MessageId, Translator } from "@/src/i18n";

/**
 * What a reader is told when a commerce API call fails.
 *
 * The API answers with problem+json whose `title` is English on purpose: it is
 * the integrator contract, stable across releases and read by log tooling, so
 * it is never translated and never shown. What reaches a person is decided
 * here, at the interface boundary, from the two fields that are stable --
 * `code` and the HTTP `status` -- in the reader's language.
 *
 * `fallback` is the caller's own sentence for a failure this cannot classify
 * (a 422 whose code is specific to one surface, say). Nothing falls back to
 * the error's `message`.
 */
export interface ProblemTextOptions {
  /** Said when nothing more specific applies. */
  fallback: string;
  /** Replaces the generic 404 sentence, which speaks of a record. */
  notFound?: string;
  /** Replaces the generic 403 sentence, which speaks of an action. */
  forbidden?: string;
}

const byCode: Readonly<Record<string, MessageId>> = {
  CSRF_MISSING: "experience.problem.secureToken",
  CSRF_INVALID: "experience.problem.secureToken",
  ORIGIN_FORBIDDEN: "experience.problem.secureToken",
  CANONICAL_ORIGIN_MISMATCH: "experience.problem.secureToken",
  AUTHENTICATION_REQUIRED: "experience.problem.session",
  IDEMPOTENCY_CONFLICT: "experience.problem.duplicate",
  VERSION_CONFLICT: "projection.action.conflict",
  EVIDENCE_VERSION_CONFLICT: "projection.action.conflict",
  EVIDENCE_STATE_CONFLICT: "projection.action.conflict",
  RENDER_VERSION_CONFLICT: "projection.action.conflict",
  RENDER_STATE_CONFLICT: "projection.action.conflict",
  ARTIFACT_SOURCE_VERSION_CONFLICT: "projection.action.conflict",
  EVIDENCE_MIME_FORBIDDEN: "experience.evidence.wrongType",
  EVIDENCE_TYPE_INVALID: "experience.evidence.wrongType",
  EVIDENCE_QUARANTINED: "experience.evidence.quarantined",
  EVIDENCE_UPLOAD_EXPIRED: "experience.evidence.expired",
  ARTIFACT_RESPONSE_INVALID: "experience.artifacts.integrityFailed",
};

/** The stable parts of a failure; `null` for anything that carries neither. */
export function problemFacts(
  error: unknown,
): { code: string | null; status: number | null } | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  const status = (error as { status?: unknown }).status;
  return {
    code: typeof code === "string" ? code : null,
    status: typeof status === "number" ? status : null,
  };
}

export function problemText(
  error: unknown,
  t: Translator,
  options: ProblemTextOptions,
): string {
  const facts = problemFacts(error);
  const known = facts?.code ? byCode[facts.code] : undefined;
  if (known) return t(known);
  const status = facts?.status ?? null;
  // A fetch that never reached the server rejects with a TypeError and no
  // status; to the reader that is the service not answering.
  if (status === null)
    return error instanceof TypeError
      ? t("experience.problem.unavailable")
      : options.fallback;
  if (status === 401) return t("experience.problem.session");
  if (status === 403)
    return options.forbidden ?? t("experience.problem.forbidden");
  if (status === 404 || status === 410)
    return options.notFound ?? t("experience.problem.notFound");
  if (status === 409) return t("projection.action.conflict");
  if (status >= 500) return t("experience.problem.unavailable");
  return options.fallback;
}
