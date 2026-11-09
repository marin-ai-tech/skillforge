import type { JsonRpcError, JsonRpcId, JsonRpcResponse, McpToolResult } from "./types.ts";
import { DEFAULT_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "./types.ts";

export function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  return { jsonrpc: "2.0", id, error };
}

export function parseErrorResponse(): JsonRpcResponse {
  return rpcError(null, -32700, "Parse error");
}

/** tools/call response: JSON-RPC envelope only (result holds tool fields). */
export function toolCallResponse(id: JsonRpcId, toolResult: McpToolResult): JsonRpcResponse {
  return rpcResult(id, toolResult);
}

export function negotiateProtocolVersion(requested: unknown): string {
  if (
    typeof requested === "string" &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return DEFAULT_PROTOCOL_VERSION;
}

export function isNotification(msg: { id?: unknown }): boolean {
  return !Object.prototype.hasOwnProperty.call(msg, "id");
}
