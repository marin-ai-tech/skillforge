import fs from "node:fs";
import path from "node:path";
import {
  OPENCODE_CONFIG_FILES,
  OPENCODE_RULES_GLOB,
  splitFrontmatter,
  planOpencodeInstructions,
  type OpencodeConfigFile,
} from "@skillforge/core";
import type { UnzippedFile } from "./bundle.ts";
import { ApiError } from "./client.ts";
import type { AppContext } from "./context.ts";
import { EXIT } from "./exit.ts";

/**
 * opencode-rules: make sure the project's OpenCode config lists `.opencode/rules/*.md` in `instructions`. Runs before
 * any rule file is written; an unreadable config stops the install with the line to add by hand.
 */
export function ensureOpencodeInstructions(
  ctx: AppContext,
  projectRoot: string,
  quiet: boolean,
): void {
  const existing: OpencodeConfigFile[] = [];
  for (const rel of OPENCODE_CONFIG_FILES) {
    const abs = path.join(projectRoot, ...rel.split("/"));
    if (fs.existsSync(abs)) existing.push({ rel, text: fs.readFileSync(abs, "utf8") });
  }
  const plan = planOpencodeInstructions(existing);
  if (!plan.ok) {
    throw new ApiError(
      `${plan.rel} is not a config SkillForge can edit (${plan.reason}); add "${OPENCODE_RULES_GLOB}" to its "instructions" by hand, then install again`,
      EXIT.VALIDATION,
    );
  }
  if (!plan.changed) return;
  const abs = path.join(projectRoot, ...plan.rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, plan.text);
  if (!quiet) ctx.out.error(`${plan.rel}: added "${OPENCODE_RULES_GLOB}" to instructions`);
}

/** OpenCode has no path-scoped rules: a rule with `paths` is loaded on every turn. */
export function warnPathRule(ctx: AppContext, files: UnzippedFile[], name: string): void {
  const main = files.find((f) => f.path === `rules/${name}.md`);
  if (!main) return;
  const { frontmatter } = splitFrontmatter(main.content.toString("utf8"));
  if (Array.isArray(frontmatter?.paths) && frontmatter.paths.length > 0) {
    ctx.out.error(
      `warning: rule/${name} has paths; OpenCode has no path rules and loads it on every turn (the paths stay in the file for the agent)`,
    );
  }
}
