import { handleMcpRequest } from "@/src/features/mcp/handler";

export const dynamic = "force-dynamic";

/**
 * The Fil One Commerce MCP endpoint. It sits outside the proxy, like the other
 * API namespaces, and authenticates each request with a personal access token
 * in the Authorization header; session cookies never authenticate it, so no
 * CSRF check applies. See docs/operations/mcp.md.
 */
export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
