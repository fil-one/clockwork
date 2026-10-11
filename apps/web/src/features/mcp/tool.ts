// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import type { z } from "zod";

import type { CommerceSession } from "@/src/auth/session";

/** What a tool runs with: the token's person, links and the audit trail. */
export interface McpToolContext {
  session: CommerceSession & {
    accessToken: NonNullable<CommerceSession["accessToken"]>;
  };
  /** The app's origin, for links back into Fil One Commerce. */
  origin: string;
  /** Ids the call named or produced, recorded on its audit event. */
  targets: Record<string, string>;
}

/**
 * One MCP tool. `access: "write"` tools change something and need a
 * `read_write` token. Each runs the same server actions, loaders and
 * permission checks as the page that does the same thing.
 */
export interface McpTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  input: Shape;
  access: "read" | "write";
  run(
    args: z.infer<z.ZodObject<Shape>>,
    context: McpToolContext,
  ): Promise<unknown>;
}

export function defineTool<Shape extends z.ZodRawShape>(
  tool: McpTool<Shape>,
): McpTool {
  return tool;
}

/** A refusal the tool reports to the client with a code and a sentence. */
export class McpToolError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly fields?: unknown,
  ) {
    super(code);
    this.name = "McpToolError";
  }
}

type Result<T> =
  { ok: true; value: T } | { ok: false; code: string; fields?: unknown };

/** The value of a server action's result, or its refusal as a tool error. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  throw new McpToolError(result.code, undefined, result.fields);
}

/** A page load's state, as the contract and partner loaders return it. */
type Loaded<T> =
  | ({ kind: "ready" } & T)
  | { kind: "denied"; code: string }
  | { kind: "missing" }
  | { kind: "error" };

export function loaded<T>(state: Loaded<T>): T {
  if (state.kind === "ready") return state;
  if (state.kind === "denied") throw new McpToolError(state.code);
  if (state.kind === "missing") throw new McpToolError("NOT_FOUND");
  throw new McpToolError("UNAVAILABLE");
}

/** An absolute link into the app. */
export const appLink = (context: McpToolContext, path: string) =>
  `${context.origin}${path}`;

/** Drops undefined, null and empty-string fields to keep results compact. */
export function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, field]) =>
        field !== undefined &&
        field !== null &&
        field !== "" &&
        !(Array.isArray(field) && field.length === 0),
    ),
  ) as Partial<T>;
}
