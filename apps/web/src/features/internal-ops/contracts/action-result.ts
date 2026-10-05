import { ZodError } from "zod";

/**
 * What a contract or sales-library server action returns. Failures carry a
 * code and, for invalid input, the field each problem belongs to, so the
 * form can say what to fix. Thrown messages never reach the browser unless
 * they are one of our upper-case codes; provider and database text stays on
 * the server.
 */
export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; fields?: Record<string, string> };

const codePattern = /^(?:[A-Z][A-Z0-9_]{2,80}|provider_unavailable)$/;

export function failure(error: unknown): {
  ok: false;
  code: string;
  fields?: Record<string, string>;
} {
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      const path = issue.path.join(".");
      fields[path || "_"] ??=
        codePattern.test(issue.message) || /^[a-z_]+$/.test(issue.message)
          ? issue.message
          : issue.code;
    }
    return { ok: false, code: "INVALID_INPUT", fields };
  }
  if (error instanceof Error && codePattern.test(error.message))
    return { ok: false, code: error.message };
  return { ok: false, code: "UNEXPECTED" };
}

export async function attempt<T>(
  operation: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return failure(error);
  }
}
