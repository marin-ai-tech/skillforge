import path from "node:path";
import type { AppContext } from "../context.ts";
import { requireClient, setExit } from "../context.ts";
import { defaultConfigPath, loadConfig, saveConfig } from "../config.ts";
import { EXIT } from "../exit.ts";
import { collectSignals } from "../hints/signals.ts";
import { fetchAllArtifacts } from "./list.ts";

/**
 * `skillforge suggest` (context-hints): skills of the registry that match this project. Signals are gathered and
 * matched on this machine; the registry only receives the usual catalogue read. Nothing happens without consent.
 */
export type SuggestOpts = { dir?: string; accept?: boolean; revoke?: boolean };

const CONSENT_TEXT = [
  "skillforge suggest reads the names of files and dependencies in this project (package.json, requirements,",
  "pyproject.toml, go.mod, Cargo.toml, file extensions, Dockerfile and similar) to suggest registry skills.",
  "These signals stay on this machine: the registry only receives the usual catalogue request.",
  "Run again with --accept to agree; --revoke withdraws the consent.",
].join("\n");

type Suggestion = {
  type: string;
  name: string;
  description: string;
  matched: string[];
  install: string;
};

function setConsent(accepted: boolean): void {
  const file = defaultConfigPath();
  const cfg = loadConfig(file);
  if (accepted) cfg.hints_consent = { accepted_at: new Date().toISOString() };
  else delete cfg.hints_consent;
  saveConfig(cfg, file);
}

function print(ctx: AppContext, signals: string[], suggestions: Suggestion[]): void {
  if (ctx.out.json) {
    ctx.out.printJson({ signals, suggestions });
    return;
  }
  if (suggestions.length === 0) {
    ctx.out.write(
      `No registry skills match this project (signals: ${signals.join(", ") || "none"}).`,
    );
    return;
  }
  ctx.out.printTable(
    ["type", "name", "matched", "install"],
    suggestions.map((s) => [s.type, s.name, s.matched.join(", "), s.install]),
  );
}

export async function runSuggest(ctx: AppContext, opts: SuggestOpts): Promise<void> {
  if (opts.revoke) {
    setConsent(false);
    ctx.out.write("Consent for project hints withdrawn.");
    setExit(EXIT.OK);
    return;
  }
  if (opts.accept) setConsent(true);
  if (!loadConfig(defaultConfigPath()).hints_consent) {
    ctx.out.error(CONSENT_TEXT);
    setExit(EXIT.INVALID_INPUT);
    return;
  }
  const signals = collectSignals(path.resolve(opts.dir ?? process.cwd()));
  const wanted = new Set(signals);
  const { client } = requireClient(ctx);
  const items = await fetchAllArtifacts(client, { status: "active" });
  const suggestions = items
    .filter((a) => a.status === "active")
    .map((a) => ({
      a,
      matched: (a.tags ?? []).map((t) => t.toLowerCase()).filter((t) => wanted.has(t)),
    }))
    .filter((x) => x.matched.length > 0)
    .sort((x, y) => y.matched.length - x.matched.length || x.a.name.localeCompare(y.a.name))
    .map(({ a, matched }) => ({
      type: a.type,
      name: a.name,
      description: a.description,
      matched,
      install: `skillforge install ${a.type}/${a.name}`,
    }));
  print(ctx, signals, suggestions);
  setExit(EXIT.OK);
}
