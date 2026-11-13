import { extractFrontmatter } from "../artifact/frontmatter.ts";

/**
 * A rule for Cursor (rule-artifacts): `.cursor/rules/<name>.mdc` with Cursor's own frontmatter — `description`,
 * `globs` (the rule's `paths` joined with commas) and `alwaysApply` (true without `paths`). The body is unchanged.
 * Verified against https://cursor.com/docs/context/rules (12.11.2026).
 */
export type RuleTranslation = { path: string; content: string };

/** A YAML plain scalar when it is safe, otherwise a double-quoted one. */
function yamlString(value: string): string {
  return /^[\w .,/*?{}()[\]@!-]*$/.test(value) &&
    !/^[\s!&*?{[-]/.test(value) &&
    !value.includes(": ")
    ? value
    : JSON.stringify(value);
}

export function translateRule(name: string, text: string): RuleTranslation {
  const { frontmatter, body } = extractFrontmatter(text);
  const fm = frontmatter ?? {};
  const paths = Array.isArray(fm.paths)
    ? fm.paths.filter((p): p is string => typeof p === "string")
    : [];
  const lines = ["---"];
  if (typeof fm.description === "string") lines.push(`description: ${yamlString(fm.description)}`);
  if (paths.length > 0) lines.push(`globs: ${paths.join(",")}`);
  lines.push(`alwaysApply: ${paths.length === 0}`, "---");
  return { path: `rules/${name}.mdc`, content: `${lines.join("\n")}\n${body}` };
}
