// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { AccessTokenToolCall } from "@clockwork/db";

import { toolFailure } from "./errors";
import { mcpTools } from "./registry";
import type { McpTool, McpToolContext } from "./tool";

export const mcpServerInfo = { name: "fil-one-commerce", version: "1.0.0" };

const instructions = [
  "Fil One Commerce is the staff portal for MNDAs, contracts, partners, indicative pricing, handoffs and the sales library.",
  "Every tool acts as the person who created the token, with their current permissions, and every call is audited.",
  "Call whoami first. Read before you write: write tools take the id and version you read.",
  "No tool sends, reminds or voids anything, or contacts a partner or any other external party: tools draft and prepare, and a person reviews and sends from the app using the link each draft returns.",
  "Approvals, team and role changes, settings and anything that needs a fresh MFA check are done in the app.",
].join(" ");

export type RecordCall = (
  call: Omit<AccessTokenToolCall, "tokenId" | "actor" | "requestId">,
) => Promise<void>;

/** Whether a token of this scope may use the tool. */
export const toolAllowed = (tool: McpTool, scope: "read" | "read_write") =>
  tool.access === "read" || scope === "read_write";

/**
 * Runs one tool call: the scope check, the tool itself, and one audit event
 * whatever the outcome. A refusal comes back as a tool error the model can
 * read; nothing from a provider or the database is echoed.
 */
export async function runTool(
  tool: McpTool,
  args: unknown,
  context: Omit<McpToolContext, "targets">,
  record: RecordCall,
): Promise<CallToolResult> {
  const targets: Record<string, string> = {};
  let result: CallToolResult;
  let outcome: "ok" | "refused" | "failed" = "ok";
  let code: string | undefined;
  try {
    if (!toolAllowed(tool, context.session.accessToken.scope)) {
      outcome = "refused";
      code = "READ_ONLY_TOKEN";
      result = {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: code,
              message:
                "This token is read-only. Create a read_write token on your Settings page to make changes.",
            }),
          },
        ],
      };
    } else {
      const value = await tool.run(args as never, { ...context, targets });
      result = { content: [{ type: "text", text: JSON.stringify(value) }] };
    }
  } catch (error) {
    const failed = toolFailure(error, context.origin);
    outcome = failed.outcome;
    code = failed.code;
    result = {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: failed.code,
            message: failed.message,
            ...(failed.fields ? { fields: failed.fields } : {}),
          }),
        },
      ],
    };
  }
  await record({
    tool: tool.name,
    outcome,
    ...(code ? { code } : {}),
    targets,
  });
  return result;
}

/**
 * A server for one request, listing the tools the token's scope allows.
 * Stateless: a new one answers every POST.
 */
export function createCommerceMcpServer(
  context: Omit<McpToolContext, "targets">,
  record: RecordCall,
): McpServer {
  const scope = context.session.accessToken.scope;
  const server = new McpServer(mcpServerInfo, {
    instructions:
      scope === "read"
        ? `${instructions} This token is read-only: tools that change something are disabled and not listed.`
        : instructions,
  });
  for (const tool of mcpTools) {
    const registered = server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.access === "read",
          openWorldHint: false,
        },
      },
      (args: unknown) => runTool(tool, args, context, record),
    );
    // A read-only token does not list write tools, and calling one is
    // refused as disabled before it runs.
    if (!toolAllowed(tool, scope)) registered.disable();
  }
  return server;
}
