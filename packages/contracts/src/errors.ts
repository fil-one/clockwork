import { z } from "zod";

/** RFC 9457 problem details with stable machine-readable Clockwork extensions. */
export const ProblemDetailsSchema = z
  .object({
    type: z.url().default("about:blank"),
    title: z.string().min(1),
    status: z.int().min(400).max(599),
    detail: z.string().optional(),
    instance: z.string().optional(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    requestId: z.string().min(8),
    errors: z.record(z.string(), z.array(z.string())).optional(),
    retryable: z.boolean().default(false),
  })
  .strict();

export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

export class ProblemError extends Error {
  public constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = "ProblemError";
  }
}

/**
 * Canonical denial codes. Runtime alerting matches on these, so a boundary that
 * refuses a caller must emit one of them and nothing else.
 */
export const denialCodes = [
  "AUTHORIZATION_DENIED",
  "CROSS_ACCOUNT_DENIED",
  "WEBHOOK_SIGNATURE_INVALID",
] as const;

export type DenialCode = (typeof denialCodes)[number];

/**
 * Boundary-specific codes that predate the canonical set and stay on the wire
 * because clients and contract tests depend on them.
 */
const mappedDenialCodes = {
  ACCOUNT_SCOPE: "CROSS_ACCOUNT_DENIED",
  ACCOUNT_SCOPE_FORBIDDEN: "CROSS_ACCOUNT_DENIED",
  INTERNAL_ACCOUNT_FILTER_FORBIDDEN: "CROSS_ACCOUNT_DENIED",
  ASSISTED_SESSION_INVALID: "AUTHORIZATION_DENIED",
  ASSISTED_SESSION_REQUIRED: "AUTHORIZATION_DENIED",
  AUDIENCE_FORBIDDEN: "AUTHORIZATION_DENIED",
  FORBIDDEN: "AUTHORIZATION_DENIED",
  STAFF_BOUNDARY: "AUTHORIZATION_DENIED",
} as const satisfies Record<string, DenialCode>;

export function isDenialCode(value: unknown): value is DenialCode {
  return (
    typeof value === "string" &&
    denialCodes.includes(value as (typeof denialCodes)[number])
  );
}

/** Resolves any known denial code to its canonical form. */
export function canonicalDenialCode(value: unknown): DenialCode | undefined {
  if (isDenialCode(value)) return value;
  if (typeof value !== "string") return undefined;
  return (mappedDenialCodes as Record<string, DenialCode>)[value];
}
