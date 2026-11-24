import {
  checkProfileUrl,
  defaultConfigPath,
  isExplicitProfileSource,
  loadConfig,
  profileNotFoundError,
  selectProfile,
  type SkillforgeConfig,
} from "../config.ts";
import { ConfigError } from "../config-error.ts";
import type { AppContext } from "../context.ts";
import { setExit } from "../context.ts";
import { EXIT } from "../exit.ts";

export type ProfileListItem = {
  name: string;
  url: string;
  token: boolean;
  mcp_token: boolean;
  default: boolean;
};

export type ProfileListActive = {
  name: string;
  source: string;
  binding_path?: string;
};

type ActiveResult = {
  active: ProfileListActive | null;
  ambiguous?: string[];
  reason?: string;
};

function resolveActive(cfg: SkillforgeConfig, ctx: AppContext, configPath: string): ActiveResult {
  try {
    const selected = selectProfile({ url: ctx.globals.url, profile: ctx.globals.profile }, cfg);
    if (isExplicitProfileSource(selected.source)) {
      const name = selected.name;
      if (!name || !cfg.registries[name]) {
        const err = profileNotFoundError(name ?? "", selected.source, configPath, cfg);
        return { active: null, reason: err.message };
      }
      checkProfileUrl(name, selected.source, cfg.registries[name], { url: ctx.globals.url });
    }
    if (!selected.name) return { active: null };
    const active: ProfileListActive = { name: selected.name, source: selected.source };
    if (selected.bindingPath) active.binding_path = selected.bindingPath;
    return { active };
  } catch (err) {
    if (err instanceof ConfigError && err.code !== "profile_binding_invalid") {
      return { active: null, ambiguous: err.details?.names, reason: err.message };
    }
    throw err;
  }
}

function yesNo(v: boolean): string {
  return v ? "yes" : "no";
}

function rowMarks(item: ProfileListItem, active: ProfileListActive | null): string {
  const marks: string[] = [];
  if (item.default) marks.push("(default)");
  if (active && active.name === item.name) {
    const src =
      active.source === "project" && active.binding_path
        ? `project ${active.binding_path}`
        : active.source;
    marks.push(`(active: ${src})`);
  }
  return marks.join(" ");
}

function printHuman(
  ctx: AppContext,
  profiles: ProfileListItem[],
  active: ProfileListActive | null,
): void {
  ctx.out.write("NAME  URL  TOKEN  MCP TOKEN");
  for (const item of profiles) {
    const marks = rowMarks(item, active);
    const row = `${item.name}  ${item.url}  ${yesNo(item.token)}  ${yesNo(item.mcp_token)}`;
    ctx.out.write(marks ? `${row}  ${marks}` : row);
  }
}

export async function runProfileList(ctx: AppContext): Promise<void> {
  const configPath = defaultConfigPath();
  const cfg = loadConfig(configPath);
  const profiles: ProfileListItem[] = Object.entries(cfg.registries).map(([name, entry]) => ({
    name,
    url: entry.url,
    token: Boolean(entry.token),
    mcp_token: Boolean(entry.mcp_token),
    default: cfg.default === name,
  }));
  const { active, ambiguous, reason } = resolveActive(cfg, ctx, configPath);
  if (reason) ctx.out.error(reason);
  if (ctx.out.json) {
    const payload: {
      profiles: ProfileListItem[];
      active: ProfileListActive | null;
      ambiguous?: string[];
    } = { profiles, active };
    if (ambiguous && ambiguous.length > 0) payload.ambiguous = ambiguous;
    ctx.out.printJson(payload);
  } else {
    printHuman(ctx, profiles, active);
  }
  setExit(EXIT.OK);
}
