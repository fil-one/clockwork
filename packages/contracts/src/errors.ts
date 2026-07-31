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
