import { ARTIFACT_TYPES as CORE_ARTIFACT_TYPES, type ArtifactType } from "@skillforge/core";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

export type McpTextContent = { type: "text"; text: string };

export type McpToolResult = {
  content: McpTextContent[];
  structuredContent?: unknown;
  isError?: boolean;
};

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

export const DEFAULT_PROTOCOL_VERSION = "2025-11-25";

export const ARTIFACT_TYPES = CORE_ARTIFACT_TYPES.map((t) => t.id);
export type ArtifactTypeName = ArtifactType;

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const MAX_FILE_BYTES = 256 * 1024;
/** Ceiling for a non-text file returned as base64 by read_artifact_file (mcp-artifact-files). */
export const MAX_BINARY_BYTES = 4 * 1024 * 1024;
/** Ceiling for the file bytes of one read_artifact_files answer (mcp-read-files). */
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
