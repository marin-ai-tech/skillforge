import type { PluginState } from "./registry.ts";
import { pluginRegistry } from "./registry.ts";

/**
 * plugin-mcp-tools: MCP tools a plugin adds to /mcp (capability `mcp`). The plugin reads the registry only through
 * `call.registry` — the built-in tools, called with the caller's token — so it never sees more than the token does.
 */
export const MCP_CAPABILITY = "mcp";
export const PLUGIN_TOOL_TIMEOUT_MS = 30_000;
const MAX_ERROR_TEXT = 500;
const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

export type ToolAudience = "agent" | "integration";
export type PluginToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  audience: ToolAudience;
};
export type PluginToolCaller = { username: string; role: string; integration: boolean };
export type PluginToolCall = {
  caller: PluginToolCaller;
  /** A built-in MCP tool as the caller: its structured result, or an Error with the tool's message. */
  registry: (name: string, args: Record<string, unknown>) => Promise<unknown>;
};
export type PluginToolHandler = (
  args: Record<string, unknown>,
  call: PluginToolCall,
) => unknown | Promise<unknown>;
export type PluginTool = { plugin: string; def: PluginToolDef; handler: PluginToolHandler };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The definition as declared, or an Error naming what is wrong. */
function parseDef(raw: unknown, builtIn: ReadonlySet<string>): PluginToolDef {
  if (!isObject(raw)) throw new Error("mcp.tool: the definition must be an object");
  const { name, description, inputSchema, audience } = raw;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new Error(`mcp.tool: invalid tool name ${JSON.stringify(name)}`);
  }
  if (builtIn.has(name)) throw new Error(`mcp.tool ${name}: the name of a built-in MCP tool`);
  if (typeof description !== "string" || description.length < 1 || description.length > 500) {
    throw new Error(`mcp.tool ${name}: description must be 1-500 characters`);
  }
  if (!isObject(inputSchema) || inputSchema.type !== "object") {
    throw new Error(`mcp.tool ${name}: inputSchema must be an object schema`);
  }
  if (audience !== undefined && audience !== "agent" && audience !== "integration") {
    throw new Error(`mcp.tool ${name}: audience must be agent or integration`);
  }
  return { name, description, inputSchema, audience: audience ?? "agent" };
}

function declaredBy(name: string): string | null {
  for (const s of pluginRegistry.list()) {
    if (s.contributions.mcpTools.has(name)) return s.name;
  }
  return null;
}

/** ctx.mcp for a plugin with the `mcp` capability; undefined otherwise. */
export function createMcpApi(
  state: PluginState,
  builtIn: ReadonlySet<string>,
): { tool: (def: unknown, handler: PluginToolHandler) => void } | undefined {
  if (!(state.manifest?.capabilities ?? []).includes(MCP_CAPABILITY)) return undefined;
  return {
    tool: (rawDef, handler) => {
      const def = parseDef(rawDef, builtIn);
      if (typeof handler !== "function")
        throw new Error(`mcp.tool ${def.name}: handler must be a function`);
      const owner = declaredBy(def.name);
      if (owner !== null)
        throw new Error(`mcp.tool ${def.name}: already declared by plugin ${owner}`);
      state.contributions.mcpTools.set(def.name, { plugin: state.name, def, handler });
    },
  };
}

/** Tools of loaded and enabled plugins this token may see. */
export function pluginTools(integration: boolean): PluginTool[] {
  const out: PluginTool[] = [];
  for (const s of pluginRegistry.list()) {
    if (s.status !== "loaded" || !s.enabled) continue;
    for (const t of s.contributions.mcpTools.values()) {
      if (t.def.audience === "integration" && !integration) continue;
      out.push(t);
    }
  }
  return out.sort((a, b) => a.def.name.localeCompare(b.def.name));
}

export function findPluginTool(name: string, integration: boolean): PluginTool | null {
  return pluginTools(integration).find((t) => t.def.name === name) ?? null;
}

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, MAX_ERROR_TEXT);
}

/** Runs the handler with the time limit; the outcome is a value or an error text, never a throw. */
export async function runPluginTool(
  tool: PluginTool,
  args: Record<string, unknown>,
  call: PluginToolCall,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${tool.def.name} timed out`)),
      PLUGIN_TOOL_TIMEOUT_MS,
    );
  });
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => tool.handler(args, call)),
      limit,
    ]);
    return { ok: true, value };
  } catch (e) {
    console.error(`[plugin ${tool.plugin}] MCP tool ${tool.def.name} failed: ${errorText(e)}`);
    return { ok: false, error: errorText(e) };
  } finally {
    clearTimeout(timer);
  }
}
