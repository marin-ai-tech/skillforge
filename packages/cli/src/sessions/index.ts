import type { SessionAdapter } from "./adapter.ts";
import { claudeCodeAdapter } from "./claude-code.ts";
import { opencodeAdapter } from "./opencode.ts";

export type { SessionAdapter, SessionFact, ParseResult } from "./adapter.ts";

const ADAPTERS: Record<string, SessionAdapter> = {
  "claude-code": claudeCodeAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(id: string): SessionAdapter | undefined {
  return ADAPTERS[id];
}

export function listAdapterIds(): string[] {
  return Object.keys(ADAPTERS);
}
