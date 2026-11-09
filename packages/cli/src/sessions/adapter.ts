export type SessionFact = {
  skill: string;
  session_key: string;
  used_at: string;
  verification: "pass" | "fail" | "none";
  /** Set when the skill was preloaded to a subagent through `skills:`, not called. */
  basis?: "preloaded";
};

export type ParseResult = {
  facts: SessionFact[];
  sessions: number;
  invocations: number;
  skipped_lines: number;
};

export interface SessionAdapter {
  id: string;
  findFiles(root: string): string[];
  parse(file: string): ParseResult;
}
