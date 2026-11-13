#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { runEvidenceAdd, runReportUsage } from "./commands/evidence.ts";
import { runMetadataSet, runPurge } from "./commands/metadata-purge.ts";
import { runHealth } from "./commands/health.ts";
import { runDoctor } from "./commands/doctor.ts";
import { runProjectStatus } from "./commands/project.ts";
import { runInfo } from "./commands/info.ts";
import { runInstall, runOutdated, runSync, runUninstall } from "./commands/install.ts";
import { RUNTIME_OPTION, SCOPE_OPTION } from "./runtime.ts";
import { runList, runSearch } from "./commands/list.ts";
import { runSuggest } from "./commands/suggest.ts";
import { runHarvestSessions } from "./commands/harvest.ts";
import { runPackInstall, runPackList } from "./commands/pack.ts";
import { runLogin } from "./commands/login.ts";
import { runLogout } from "./commands/logout.ts";
import { runPublish, runValidate } from "./commands/publish.ts";
import { runWhoami } from "./commands/whoami.ts";
import { runSessionsImport } from "./commands/sessions.ts";
import {
  runTeamsList,
  runTeamsShow,
  runTeamsCreate,
  runTeamsAdd,
  runTeamsRemove,
} from "./commands/teams.ts";
import { runScope, runLabelsSet } from "./commands/scope.ts";
import {
  runComments,
  runComment,
  runNotifications,
  runNotificationsRead,
  runWatch,
} from "./commands/comments.ts";
import { runLifecycleBoard, runLifecycleHold, runLifecycleSweep } from "./commands/lifecycle.ts";
import { runMetrics } from "./commands/metrics.ts";
import {
  runEvalsShow,
  runEvalsPush,
  runEvalsRun,
  runEvalsRuns,
  runEvalsBatch,
  runEvalsBatches,
  runEvalsJournal,
} from "./commands/evals.ts";
import { runRunsList, runRunsShow } from "./commands/runs.ts";
import {
  runWorkflowsList,
  runWorkflowsSave,
  runWorkflowsRun,
  runWorkflowsTrace,
} from "./commands/workflows.ts";
import {
  runRoutinesList,
  runRoutinesSave,
  runRoutinesRun,
  runRoutinesRuns,
  runRoutinesDisable,
} from "./commands/routines.ts";
import {
  runHooksList,
  runHooksSubscribe,
  runHooksUnsubscribe,
  runHooksDecisions,
  runHooksEvaluate,
} from "./commands/hooks.ts";

import { runMcp } from "./commands/mcp.ts";
import { runPluginDir } from "./commands/plugin-dir.ts";
import { runSettingsApply } from "./commands/settings.ts";
import {
  runAgentScan,
  runAgentStatus,
  runAgentList,
  runAgentPublish,
  runAgentRm,
} from "./commands/agent.ts";
import { createContext, handleError, setExit, type GlobalOpts } from "./context.ts";
import { EXIT } from "./exit.ts";
import { Output } from "./output.ts";
import { parseRootVersionArgs } from "./root-args.ts";

function cliVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(path.resolve(here, "../package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

function addGlobals(cmd: Command): Command {
  return cmd
    .option("--url <base>", "Registry base URL")
    .option("--token <token>", "Bearer token")
    .option("--json", "JSON output only on stdout", false)
    .option("--no-color", "Disable ANSI colors");
}

function globalsFrom(cmd: Command): GlobalOpts {
  const opts = cmd.opts() as {
    url?: string;
    token?: string;
    json?: boolean;
    color?: boolean;
  };
  // Also inspect argv: some commander layouts drop --json on nested commands when
  // the parent also defines --json after subcommands were registered.
  const argvHasJson = process.argv.includes("--json");
  return {
    url: opts.url,
    token: opts.token,
    json: Boolean(opts.json) || argvHasJson,
    noColor: opts.color === false,
  };
}

const program = new Command();
program
  .name("skillforge")
  .description("SkillForge CLI — thin client for the SkillForge registry API");

addGlobals(program.command("health").description("Check SkillForge server health")).action(
  async (opts: { url?: string }, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    await runHealth(ctx, opts.url ?? ctx.globals.url);
  },
);

addGlobals(
  program
    .command("doctor")
    .description("Health/status checklist, or download an admin diagnostics bundle (--bundle)")
    .option("--bundle", "Download an admin diagnostics bundle from the server", false)
    .option("--output <path>", "Output path for --bundle archive"),
).action(async (opts: { bundle?: boolean; output?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runDoctor(ctx, {
      bundle: Boolean(opts.bundle),
      output: opts.output,
    });
  } catch (e) {
    handleError(ctx, e);
  }
});

const project = program
  .command("project")
  .description("Local project status versus the SkillForge registry");

addGlobals(
  project
    .command("status")
    .description(
      "Compare local install lock to the registry (exit codes; --json: ok/checks/status/summary)",
    )
    .option("--into <dir>", "Install root (default: runtime project dir / .claude)"),
).action(async (opts: { into?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runProjectStatus(ctx, { into: opts.into });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("login")
    .description("Log in and store credentials in the local config")
    .option("--username <user>", "Username for password login")
    .option("--password-stdin", "Read password from stdin", false)
    .option("--name <name>", "Config entry name (default: host[:port])"),
).action(
  async (
    opts: {
      username?: string;
      passwordStdin?: boolean;
      name?: string;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      const url = ctx.globals.url;
      if (!url) {
        ctx.out.error("Missing --url (or set SKILLFORGE_URL)");
        process.exitCode = 1;
        return;
      }
      await runLogin(ctx, {
        url,
        token: ctx.globals.token,
        username: opts.username,
        passwordStdin: Boolean(opts.passwordStdin),
        name: opts.name,
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program.command("logout").description("Revoke the stored token and remove the config entry"),
).action(async (_opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runLogout(ctx);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(program.command("whoami").description("Show the current authenticated user")).action(
  async (_opts: unknown, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runWhoami(ctx);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("validate")
    .description("Validate an artifact directory or file without publishing")
    .argument("<path>", "Artifact directory or file")
    .option("--type <type>", "Artifact type")
    .option("--name <name>", "Artifact name override")
    .option("--description <text>", "Description override")
    .option("--version <version>", "Version")
    .option("--changelog <text>", "Changelog")
    .option("--provenance <source[:ref]>", "Provenance source[:ref]"),
).action(async (inputPath: string, opts: Record<string, string | undefined>, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runValidate(ctx, inputPath, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("publish")
    .description("Validate and publish an artifact")
    .argument("<path>", "Artifact directory or file")
    .option("--type <type>", "Artifact type")
    .option("--name <name>", "Artifact name override")
    .option("--description <text>", "Description override")
    .option("--version <version>", "Version")
    .option("--changelog <text>", "Changelog")
    .option("--provenance <source[:ref]>", "Provenance source[:ref]")
    .option("--visibility <visibility>", "Scope: org | team (first publish)")
    .option("--team <name>", "Owner team when --visibility team")
    .option("--agents <list>", "Agents the artifact is for, e.g. claude-code>=2.1,codex"),
).action(async (inputPath: string, opts: Record<string, string | undefined>, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runPublish(ctx, inputPath, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("list")
    .description("List artifacts")
    .option("--type <type>", "Filter by type")
    .option("--status <status>", "Filter by status")
    .option("--tag <tag>", "Filter by tag")
    .option("--team <name>", "Filter by owner team")
    .option("--owner <user>", "Filter by owner username")
    .option("--label <label>", "Filter by registry label")
    .option("--visibility <visibility>", "Filter by visibility: org | team")
    .option("--limit <n>", "Page size"),
).action(async (opts: Record<string, string | undefined>, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runList(ctx, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("search")
    .description("Search artifacts")
    .argument("<query>", "Search query")
    .option("--type <type>", "Filter by type")
    .option("--status <status>", "Filter by status")
    .option("--tag <tag>", "Filter by tag")
    .option("--limit <n>", "Page size"),
).action(async (query: string, opts: Record<string, string | undefined>, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runSearch(ctx, query, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("suggest")
    .description("Suggest registry skills for this project from local signals (needs consent)")
    .option("--dir <path>", "Project directory (default: current)")
    .option("--accept", "Agree that the CLI reads file and dependency names of this project")
    .option("--revoke", "Withdraw the consent"),
).action(async (opts: { dir?: string; accept?: boolean; revoke?: boolean }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runSuggest(ctx, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

const pack = program
  .command("pack")
  .description("Team method packs: roles with pinned artifact versions");
addGlobals(
  pack
    .command("install")
    .description("Install a pack (or one role of it) at its pinned versions")
    .argument("<name[@version]>", "Pack, latest version unless given")
    .option("--role <role>", "Only this role")
    .option("--into <dir>", "Install root (default: .claude)")
    .option("--runtime <id>", RUNTIME_OPTION)
    .option("--scope <scope>", SCOPE_OPTION)
    .option("--force", "Overwrite local changes", false),
).action(
  async (
    spec: string,
    opts: { role?: string; into?: string; runtime?: string; scope?: string; force?: boolean },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runPackInstall(ctx, spec, opts as Parameters<typeof runPackInstall>[2]);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);
addGlobals(pack.command("list").description("List team method packs")).action(
  async (_opts: unknown, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runPackList(ctx);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

const harvest = program
  .command("harvest")
  .description("Collect recurring rules from past work into rule (or skill) drafts");
addGlobals(
  harvest
    .command("sessions")
    .description(
      "Draft a rule from rules you keep asking your agent for (local session logs, no network)",
    )
    .option("--dir <path>", "Session logs (default: ~/.claude/projects)")
    .option("--out <dir>", "Where to write rules/<name>.md (or skills/<name>/SKILL.md)")
    .option("--name <name>", "Draft name, kebab-case")
    .option("--min <n>", "How many times a rule must recur (default 3)")
    .option("--type <type>", "rule (default) or skill"),
).action(
  async (
    opts: { dir?: string; out?: string; name?: string; min?: string; type?: string },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runHarvestSessions(ctx, opts);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("info")
    .description("Show artifact details and install commands")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runInfo(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("install")
    .description("Install an artifact bundle into a local directory")
    .argument(
      "<type/name[@spec]>",
      "Artifact to install; spec: latest (clears pin), beta, 1.2.3, =1.2.3 or a range like ^0.2 (saved as pin)",
    )
    .option("--into <dir>", "Install root (default: .claude)")
    .option("--runtime <id>", RUNTIME_OPTION)
    .option("--scope <scope>", SCOPE_OPTION)
    .option("--force", "Overwrite local changes", false)
    .option("--allow-downgrade", "Allow installing a lower version than the installed one", false)
    .option("--allow-risky", "Install even if the registry's security scan failed", false),
).action(
  async (
    spec: string,
    opts: {
      into?: string;
      runtime?: string;
      scope?: string;
      force?: boolean;
      allowDowngrade?: boolean;
      allowRisky?: boolean;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runInstall(ctx, spec, {
        into: opts.into,
        runtime: opts.runtime,
        scope: opts.scope,
        force: Boolean(opts.force),
        allowDowngrade: Boolean(opts.allowDowngrade),
        allowRisky: Boolean(opts.allowRisky),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

const metadata = program
  .command("metadata")
  .description("Edit registry metadata without a new version");
addGlobals(
  metadata
    .command("set")
    .description("Set or reset artifact metadata")
    .argument("<type/name>")
    .option("--display-name <text>", "Display name")
    .option("--description <text>", "Description")
    .option("--tags <list>", "Comma-separated tags")
    .option(
      "--reset <field>",
      "Reset display_name, description, or tags",
      (value: string, previous: string[]) => [...previous, value],
      [],
    ),
).action(
  async (
    spec: string,
    opts: { displayName?: string; description?: string; tags?: string; reset?: string[] },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runMetadataSet(ctx, spec, opts);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("purge")
    .description("Irreversibly purge an artifact or version (admin)")
    .argument("<type/name[@version]>")
    .requiredOption("--reason <text>", "Audit reason; never include the secret")
    .requiredOption("--confirm <reference>", "Exact type/name[@version]")
    .option("--delete-backups", "Delete existing registry backups", false),
).action(
  async (
    spec: string,
    opts: { reason?: string; confirm?: string; deleteBackups?: boolean },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runPurge(ctx, spec, opts);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("sync")
    .description("Install or update artifacts matching filters; optional prune")
    .option("--into <dir>", "Install root (default: .claude)")
    .option("--runtime <id>", RUNTIME_OPTION)
    .option("--scope <scope>", SCOPE_OPTION)
    .option("--status <status>", "Filter by status")
    .option("--type <type>", "Filter by type")
    .option("--tag <tag>", "Filter by tag")
    .option("--prune", "Remove installed artifacts not in the filtered set", false)
    .option("--force", "Overwrite local changes", false)
    .option("--allow-downgrade", "Allow moving to a lower version than the installed one", false)
    .option("--allow-risky", "Install even if the registry's security scan failed", false),
).action(
  async (
    opts: {
      into?: string;
      runtime?: string;
      scope?: string;
      status?: string;
      type?: string;
      tag?: string;
      prune?: boolean;
      force?: boolean;
      allowDowngrade?: boolean;
      allowRisky?: boolean;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runSync(ctx, {
        into: opts.into,
        runtime: opts.runtime,
        scope: opts.scope,
        status: opts.status,
        type: opts.type,
        tag: opts.tag,
        prune: Boolean(opts.prune),
        force: Boolean(opts.force),
        allowDowngrade: Boolean(opts.allowDowngrade),
        allowRisky: Boolean(opts.allowRisky),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("outdated")
    .description("Show installed versions against the pinned (wanted) and latest versions")
    .option("--into <dir>", "Install root (default: .claude)")
    .option("--runtime <id>", RUNTIME_OPTION)
    .option("--scope <scope>", SCOPE_OPTION),
).action(async (opts: { into?: string; runtime?: string; scope?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runOutdated(ctx, { into: opts.into, runtime: opts.runtime, scope: opts.scope });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("uninstall")
    .description("Remove an installed artifact and its lock entry")
    .argument("<type/name>", "Artifact to uninstall")
    .option("--into <dir>", "Install root (default: .claude)")
    .option("--runtime <id>", RUNTIME_OPTION)
    .option("--scope <scope>", SCOPE_OPTION)
    .option("--force", "Remove even if your team requires it", false),
).action(
  async (
    spec: string,
    opts: { into?: string; runtime?: string; scope?: string; force?: boolean },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runUninstall(ctx, spec, {
        force: Boolean(opts.force),
        into: opts.into,
        runtime: opts.runtime,
        scope: opts.scope,
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("report-usage")
    .description("Report how often an artifact was applied and how often it helped (Transfer Rate)")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .option("--uses <n>", "Times the artifact was applied (0..100000)")
    .option("--helped <m>", "Times it helped (0..uses)")
    .option("--version <version>", "Version (default: latest)")
    .option("--source <source>", "Report source label (max 64 chars)")
    .option(
      "--report-id <id>",
      "Idempotency key: a repeated id is not counted twice (max 128 chars)",
    )
    .option(
      "--basis <basis>",
      "loaded (really applied) or assigned (only assigned to a role; not counted in Transfer Rate)",
    ),
).action(
  async (
    spec: string,
    opts: {
      uses?: string;
      helped?: string;
      version?: string;
      source?: string;
      reportId?: string;
      basis?: string;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runReportUsage(ctx, spec, opts);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

const evidenceCmd = program
  .command("evidence")
  .description(
    "Attach objective evidence (gate, run, diff, review, eval, ablation) to an artifact version",
  );

// `--url` here is the evidence link, so the registry override is `--registry <base>`.
evidenceCmd
  .command("add")
  .description("Add an evidence record to a version you can publish")
  .argument("<type/name@version>", "Artifact version, e.g. skill/pdf-tools@1.2.0 or @latest")
  .option("--kind <kind>", "gate | run | diff | review | eval | ablation")
  .option("--url <url>", "Evidence link: http(s) URL or registry path starting with /")
  .option("--file <path>", "Evidence document: a UTF-8 text file up to 64 KiB (instead of --url)")
  .option("--summary <text>", "Short summary (max 500 chars; no secrets)")
  .option("--tasks <n>", "Ablation tasks (1..1000)")
  .option("--passed-with <n>", "Ablation passed with skill")
  .option("--passed-without <n>", "Ablation passed without skill")
  .option("--runner <id>", "Optional ablation runner label (max 64)")
  .option("--registry <base>", "Registry base URL")
  .option("--token <token>", "Bearer token")
  .option("--json", "JSON output only on stdout", false)
  .option("--no-color", "Disable ANSI colors")
  .action(
    async (
      spec: string,
      opts: {
        kind?: string;
        url?: string;
        file?: string;
        summary?: string;
        tasks?: string;
        passedWith?: string;
        passedWithout?: string;
        runner?: string;
        registry?: string;
        token?: string;
        json?: boolean;
        color?: boolean;
      },
    ) => {
      const ctx = createContext({
        url: opts.registry,
        token: opts.token,
        json: Boolean(opts.json),
        noColor: opts.color === false,
      });
      try {
        await runEvidenceAdd(ctx, spec, {
          kind: opts.kind,
          url: opts.url,
          file: opts.file,
          summary: opts.summary,
          tasks: opts.tasks,
          passedWith: opts.passedWith,
          passedWithout: opts.passedWithout,
          runner: opts.runner,
        });
      } catch (e) {
        handleError(ctx, e);
      }
    },
  );

addGlobals(
  program.command("mcp").description("stdio MCP bridge to POST /mcp on the configured registry"),
).action(async (_opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runMcp(ctx);
  } catch (e) {
    handleError(ctx, e);
  }
});

program
  .command("plugin-dir")
  .description(
    "Print the path of a ready Claude Code plugin directory (marketplace command source); cached per version",
  )
  .argument("<type/name@version>", "Artifact with an exact version, e.g. skill/pdf-tools@1.0.0")
  .option("--url <base>", "Registry base URL")
  .option("--token <token>", "Bearer token")
  .action(async (spec: string, opts: { url?: string; token?: string }) => {
    const ctx = createContext({ url: opts.url, token: opts.token });
    try {
      await runPluginDir(ctx, spec);
    } catch (e) {
      handleError(ctx, e);
    }
  });

const settingsCmd = program
  .command("settings")
  .description("Apply a published settings profile to a Claude Code settings file");

addGlobals(
  settingsCmd
    .command("apply")
    .description("Merge a settings/<name> profile into user, project, or local settings")
    .argument("<settings/name[@version]>", "Settings profile to apply")
    .option("--scope <scope>", "Target scope: user | project | local")
    .option("--dry-run", "Print changes without writing", false),
).action(async (spec: string, opts: { scope?: string; dryRun?: boolean }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runSettingsApply(ctx, spec, {
      scope: opts.scope,
      dryRun: Boolean(opts.dryRun),
    });
  } catch (e) {
    handleError(ctx, e);
  }
});

const agent = program
  .command("agent")
  .description("Scan, compare, and publish from an agent directory");

addGlobals(
  agent
    .command("scan")
    .description("Upload an agent directory snapshot and show comparison")
    .argument("[dir]", "Agent directory (default: .claude)")
    .option("--name <agent>", "Agent name")
    .option(
      "--runtime <runtime>",
      "Runtime (claude-code, codex, gemini, cursor, opencode, qwen, devin, reckon, generic)",
    )
    .option(
      "--mcp",
      "Also read this runtime's MCP server configs and send names, versions and flags (never values); your consent for this run",
    ),
).action(
  async (
    dir: string | undefined,
    opts: { name?: string; runtime?: string; mcp?: boolean },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runAgentScan(ctx, dir, { name: opts.name, runtime: opts.runtime, mcp: opts.mcp });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  agent
    .command("status")
    .description("Show comparison for a stored agent")
    .option("--name <agent>", "Agent name"),
).action(async (opts: { name?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runAgentStatus(ctx, { name: opts.name });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(agent.command("list").description("List your agents")).action(
  async (_opts: unknown, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runAgentList(ctx);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  agent
    .command("publish")
    .description("Publish an item from an agent snapshot")
    .argument("<type/name>", "Item key, e.g. skill/local-notes")
    .option("--name <agent>", "Agent name")
    .option("--version <version>", "Version override")
    .option("--changelog <text>", "Changelog"),
).action(
  async (
    spec: string,
    opts: { name?: string; version?: string; changelog?: string },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runAgentPublish(ctx, spec, {
        name: opts.name,
        version: opts.version,
        changelog: opts.changelog,
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  agent
    .command("rm")
    .description("Delete a stored agent snapshot")
    .option("--name <agent>", "Agent name"),
).action(async (opts: { name?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runAgentRm(ctx, { name: opts.name });
  } catch (e) {
    handleError(ctx, e);
  }
});

const teams = program.command("teams").description("Manage teams and membership");

addGlobals(teams.command("list").description("List teams")).action(
  async (_opts: unknown, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runTeamsList(ctx);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(teams.command("show").description("Show a team").argument("<name>", "Team name")).action(
  async (name: string, _opts: unknown, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runTeamsShow(ctx, name);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  teams
    .command("create")
    .description("Create a team (admin)")
    .argument("<name>", "Team name (kebab-case)")
    .option("--lead <user>", "Initial lead username"),
).action(async (name: string, opts: { lead?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runTeamsCreate(ctx, name, { lead: opts.lead });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  teams
    .command("add")
    .description("Add a member to a team")
    .argument("<name>", "Team name")
    .argument("<user>", "Username")
    .option("--role <role>", "member | lead", "member"),
).action(async (name: string, user: string, opts: { role?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runTeamsAdd(ctx, name, user, { role: opts.role });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  teams
    .command("remove")
    .description("Remove a member from a team")
    .argument("<name>", "Team name")
    .argument("<user>", "Username"),
).action(async (name: string, user: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runTeamsRemove(ctx, name, user);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("scope")
    .description("Change artifact visibility scope")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .option("--visibility <visibility>", "org | team")
    .option("--team <name>", "Owner team when --visibility team")
    .option("--reason <text>", "Optional reason for audit"),
).action(
  async (
    spec: string,
    opts: { visibility?: string; team?: string; reason?: string },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runScope(ctx, spec, opts);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("labels")
    .description("Manage artifact registry labels")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .argument("<action>", "Action: set")
    .argument("<labels>", "Comma-separated kebab labels (for set)"),
).action(async (spec: string, action: string, labels: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    if (action !== "set") {
      ctx.out.error("labels action must be set");
      setExit(EXIT.INVALID_INPUT);
      return;
    }
    await runLabelsSet(ctx, spec, labels);
  } catch (e) {
    handleError(ctx, e);
  }
});

const sessions = program.command("sessions").description("Local agent session usage metrics");
addGlobals(
  sessions
    .command("import")
    .description("Parse local session transcripts and upload usage facts")
    .option("--harness <name>", "Session harness adapter", "claude-code")
    .option("--root <dir>", "Sessions root directory")
    .option("--since <date>", "Only facts with used_at >= date (ISO)")
    .option("--dry-run", "Print facts without uploading", false),
).action(
  async (
    opts: { harness?: string; root?: string; since?: string; dryRun?: boolean },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runSessionsImport(ctx, {
        harness: opts.harness,
        root: opts.root,
        since: opts.since,
        dryRun: Boolean(opts.dryRun),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("comments")
    .description("List comments on an artifact (threaded)")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .option("--version <version>", "Filter by version"),
).action(async (spec: string, opts: { version?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runComments(ctx, spec, { version: opts.version });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("comment")
    .description("Create a comment on an artifact")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .option("--body <text>", "Comment body")
    .option("--version <version>", "Attach to version")
    .option("--reply <id>", "Reply to comment id"),
).action(
  async (spec: string, opts: { body?: string; version?: string; reply?: string }, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runComment(ctx, spec, {
        body: opts.body,
        version: opts.version,
        reply: opts.reply,
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

const notifications = program.command("notifications").description("Notification feed");

addGlobals(
  notifications
    .command("read")
    .description("Mark notifications as read")
    .argument("[ids...]", "Notification ids")
    .option("--all", "Mark all visible unread as read", false),
).action(async (ids: string[], opts: { all?: boolean }, cmd: Command) => {
  const raw = ids ?? [];
  const jsonFromArgs = raw.includes("--json") || process.argv.includes("--json");
  const allFromArgs = Boolean(opts.all) || raw.includes("--all");
  const cleanIds = raw.filter((a) => !a.startsWith("-"));
  const g = globalsFrom(cmd);
  const ctx = createContext({ ...g, json: g.json || jsonFromArgs });
  try {
    await runNotificationsRead(ctx, { all: allFromArgs, ids: cleanIds });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  notifications.description("List notifications").option("--unread", "Only unread", false),
).action(async (opts: { unread?: boolean }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runNotifications(ctx, { unread: Boolean(opts.unread) });
  } catch (e) {
    handleError(ctx, e);
  }
});

const lifecycle = program
  .command("lifecycle")
  .description("Data lifecycle cleanup board, holds, and policy sweep");

addGlobals(lifecycle.description("Show cleanup board (reviewer+/admin)")).action(
  async (opts: { json?: boolean; url?: string; token?: string; color?: boolean }, cmd: Command) => {
    const g = globalsFrom(cmd);
    const ctx = createContext({
      url: opts.url ?? g.url,
      token: opts.token ?? g.token,
      json: Boolean(opts.json) || g.json || process.argv.includes("--json"),
      noColor: opts.color === false || g.noColor,
    });
    try {
      await runLifecycleBoard(ctx);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  lifecycle
    .command("hold")
    .description("Set or clear a lifecycle hold (reviewer+/admin)")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .option("--until <iso>", "Hold until ISO date (future, <= 365 days)")
    .option("--reason <text>", "Hold reason (min 5 characters)")
    .option("--off", "Clear the active hold", false),
).action(
  async (
    spec: string,
    opts: {
      until?: string;
      reason?: string;
      off?: boolean;
      json?: boolean;
      url?: string;
      token?: string;
      color?: boolean;
    },
    cmd: Command,
  ) => {
    const g = globalsFrom(cmd);
    const ctx = createContext({
      url: opts.url ?? g.url,
      token: opts.token ?? g.token,
      json: Boolean(opts.json) || g.json || process.argv.includes("--json"),
      noColor: opts.color === false || g.noColor,
    });
    try {
      await runLifecycleHold(ctx, spec, {
        until: opts.until,
        reason: opts.reason,
        off: Boolean(opts.off),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  lifecycle
    .command("sweep")
    .description("Run lifecycle policy sweep (admin)")
    .option("--dry-run", "Plan only; do not change statuses", false),
).action(
  async (
    opts: { dryRun?: boolean; json?: boolean; url?: string; token?: string; color?: boolean },
    cmd: Command,
  ) => {
    const g = globalsFrom(cmd);
    const ctx = createContext({
      url: opts.url ?? g.url,
      token: opts.token ?? g.token,
      json: Boolean(opts.json) || g.json || process.argv.includes("--json"),
      noColor: opts.color === false || g.noColor,
    });
    try {
      await runLifecycleSweep(ctx, { dryRun: Boolean(opts.dryRun) });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  program
    .command("metrics")
    .description("Show registry metrics board (table, --json overview, or --csv export)")
    .option("--type <type>", "Filter by artifact type")
    .option("--status <status>", "Filter by status")
    .option("--team <name>", "Filter by owner team")
    .option("--q <text>", "Search name/description")
    .option("--sort <field>", "Sort field (default transfer_rate)")
    .option("--order <asc|desc>", "Sort order (default desc)")
    .option("--limit <n>", "Page size (1-200)")
    .option("--offset <n>", "Page offset")
    .option("--csv", "Download CSV export body (requires auth)", false),
).action(
  async (
    opts: {
      type?: string;
      status?: string;
      team?: string;
      q?: string;
      sort?: string;
      order?: string;
      limit?: string;
      offset?: string;
      csv?: boolean;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runMetrics(ctx, {
        type: opts.type,
        status: opts.status,
        team: opts.team,
        q: opts.q,
        sort: opts.sort,
        order: opts.order,
        limit: opts.limit,
        offset: opts.offset,
        csv: Boolean(opts.csv),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

const evals = program.command("evals").description("Skill eval suites, runs, and journal");

addGlobals(
  evals
    .command("push")
    .description("Replace the eval suite from a JSON file")
    .argument("<type/name>", "Artifact ref")
    .option("--file <path>", "Suite JSON file (cases, optional gate)")
    .option("--gate <required|off>", "Set gate when pushing"),
).action(async (spec: string, opts: { file?: string; gate?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runEvalsPush(ctx, spec, { file: opts.file, gate: opts.gate });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  evals
    .command("run")
    .description("Enqueue an eval run (optionally wait for completion)")
    .argument("<type/name>", "Artifact ref")
    .option("--kind <kind>", "trigger | compare | ablation")
    .option("--version <ver>", "Candidate version")
    .option("--against <ver>", "Baseline version for compare")
    .option("--runner <id>", "Runner id")
    .option("--scope <scope>", "all | holdout")
    .option("--wait", "Wait until done or failed", false),
).action(
  async (
    spec: string,
    opts: {
      kind?: string;
      version?: string;
      against?: string;
      runner?: string;
      scope?: string;
      wait?: boolean;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runEvalsRun(ctx, spec, {
        kind: opts.kind,
        version: opts.version,
        against: opts.against,
        runner: opts.runner,
        scope: opts.scope,
        wait: Boolean(opts.wait),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  evals.command("runs").description("List eval runs").argument("<type/name>", "Artifact ref"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runEvalsRuns(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  evals
    .command("batch")
    .description("Enqueue an eval batch across runners (optionally wait)")
    .argument("<type/name>", "Artifact ref")
    .option("--kind <kind>", "trigger | compare | ablation")
    .option("--version <ver>", "Candidate version")
    .option("--against <ver>", "Baseline version for compare")
    .option("--runner <ids>", "Comma-separated runner ids (default: all configured)")
    .option("--scope <scope>", "all | holdout")
    .option("--wait", "Wait until done or failed", false),
).action(
  async (
    spec: string,
    opts: {
      kind?: string;
      version?: string;
      against?: string;
      runner?: string;
      scope?: string;
      wait?: boolean;
    },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runEvalsBatch(ctx, spec, {
        kind: opts.kind,
        version: opts.version,
        against: opts.against,
        runner: opts.runner,
        scope: opts.scope,
        wait: Boolean(opts.wait),
      });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  evals.command("batches").description("List eval batches").argument("<type/name>", "Artifact ref"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runEvalsBatches(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  evals
    .command("journal")
    .description("Show eval journal by version")
    .argument("<type/name>", "Artifact ref"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runEvalsJournal(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  evals
    .argument("[type/name]", "Artifact ref — show suite, gate, and runners")
    .description("Show eval suite (or use subcommands push/run/runs/journal)"),
).action(async (spec: string | undefined, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    if (!spec) {
      ctx.out.error(
        "usage: skillforge evals <type/name> | push | run | runs | batch | batches | journal",
      );
      setExit(EXIT.INVALID_INPUT);
      return;
    }
    await runEvalsShow(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

const runs = program
  .command("runs")
  .description("Run outputs (stdout/stderr) recorded for eval and process runs");

addGlobals(
  runs
    .command("list")
    .description("List run outputs of an artifact (newest first)")
    .argument("<type/name>", "Artifact ref")
    .option("--version <ver>", "Only outputs of this artifact version")
    .option("--run <id>", "Only outputs of this run id, e.g. eval:42")
    .option("--kind <kind>", "Only this run kind, e.g. eval")
    .option("--limit <n>", "Max rows (1-200, default 50)"),
).action(
  async (
    spec: string,
    opts: { version?: string; run?: string; kind?: string; limit?: string },
    cmd: Command,
  ) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runRunsList(ctx, spec, opts);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  runs
    .command("show")
    .description("Show run output metadata, or the raw content with --raw")
    .argument("<type/name>", "Artifact ref")
    .argument("<id>", "Run output id")
    .option("--raw", "Print the stored content to stdout as is", false),
).action(async (spec: string, id: string, opts: { raw?: boolean }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runRunsShow(ctx, spec, id, { raw: Boolean(opts.raw) });
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  program
    .command("watch")
    .description("Watch or unwatch an artifact")
    .argument("<type/name>", "Artifact id, e.g. skill/pdf-tools")
    .option("--off", "Stop watching", false),
).action(async (spec: string, opts: { off?: boolean }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runWatch(ctx, spec, { off: Boolean(opts.off) });
  } catch (e) {
    handleError(ctx, e);
  }
});

const workflows = program
  .command("workflows")
  .description("Artifact workflows: definitions, runs, traces");

addGlobals(
  workflows
    .command("list")
    .description("List workflow definitions of an artifact")
    .argument("<type/name>", "Artifact ref"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runWorkflowsList(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  workflows
    .command("save")
    .description("Create or update a workflow definition from a JSON file")
    .argument("<type/name>", "Artifact ref")
    .argument("<workflow>", "Workflow id")
    .requiredOption("--file <path>", "Workflow definition JSON"),
).action(async (spec: string, wf: string, opts: { file: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runWorkflowsSave(ctx, spec, wf, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  workflows
    .command("run")
    .description("Enqueue a workflow run (optionally wait for completion)")
    .argument("<type/name>", "Artifact ref")
    .argument("<workflow>", "Workflow id")
    .option("--input <json>", "Run input as JSON")
    .option("--wait", "Wait until done, failed or cancelled", false),
).action(
  async (spec: string, wf: string, opts: { input?: string; wait?: boolean }, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runWorkflowsRun(ctx, spec, wf, { input: opts.input, wait: Boolean(opts.wait) });
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  workflows
    .command("trace")
    .description("Show a workflow run trace (steps, exit codes, branch targets)")
    .argument("<type/name>", "Artifact ref")
    .argument("<runId>", "Run id"),
).action(async (spec: string, runId: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runWorkflowsTrace(ctx, spec, runId);
  } catch (e) {
    handleError(ctx, e);
  }
});

const routines = program
  .command("routines")
  .description("Artifact routines: scheduled commands, budgets, runs");

addGlobals(
  routines
    .command("list")
    .description("List routine definitions of an artifact")
    .argument("<type/name>", "Artifact ref"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runRoutinesList(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  routines
    .command("save")
    .description("Create or update a routine definition from a JSON file")
    .argument("<type/name>", "Artifact ref")
    .argument("<routine>", "Routine id")
    .requiredOption("--file <path>", "Routine definition JSON"),
).action(async (spec: string, rt: string, opts: { file: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runRoutinesSave(ctx, spec, rt, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  routines
    .command("run")
    .description("Trigger a routine run manually")
    .argument("<type/name>", "Artifact ref")
    .argument("<routine>", "Routine id"),
).action(async (spec: string, rt: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runRoutinesRun(ctx, spec, rt);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  routines
    .command("runs")
    .description("List routine runs of an artifact")
    .argument("<type/name>", "Artifact ref"),
).action(async (spec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runRoutinesRuns(ctx, spec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  routines
    .command("disable")
    .description("Disable a routine (kill switch)")
    .argument("<type/name>", "Artifact ref")
    .argument("<routine>", "Routine id"),
).action(async (spec: string, rt: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runRoutinesDisable(ctx, spec, rt);
  } catch (e) {
    handleError(ctx, e);
  }
});

const hooks = program
  .command("hooks")
  .description("Platform hook subscriptions, evaluation and decisions");

addGlobals(hooks.command("list").description("List hook subscriptions")).action(
  async (_opts: unknown, cmd: Command) => {
    const ctx = createContext(globalsFrom(cmd));
    try {
      await runHooksList(ctx);
    } catch (e) {
      handleError(ctx, e);
    }
  },
);

addGlobals(
  hooks
    .command("subscribe")
    .description("Subscribe a published hook artifact version (admin)")
    .argument("<type/name>", "Hook artifact ref")
    .option("--version <ver>", "Artifact version (default: latest)"),
).action(async (spec: string, opts: { version?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runHooksSubscribe(ctx, spec, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  hooks
    .command("unsubscribe")
    .description("Remove a hook subscription by id or <type>/<name> (admin)")
    .argument("<id|type/name>", "Subscription id or hook artifact ref"),
).action(async (idOrSpec: string, _opts: unknown, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runHooksUnsubscribe(ctx, idOrSpec);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  hooks
    .command("decisions")
    .description("List hook runtime decisions (admin, reviewer)")
    .option("--limit <n>", "Max rows (default 200)"),
).action(async (opts: { limit?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runHooksDecisions(ctx, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

addGlobals(
  hooks
    .command("evaluate")
    .description("Evaluate subscribed hooks for an event")
    .requiredOption("--event <event>", "Hook event (e.g. PreToolUse)")
    .option("--tool <name>", "Tool name for matcher filtering")
    .option("--input <json>", "JSON input payload"),
).action(async (opts: { event: string; tool?: string; input?: string }, cmd: Command) => {
  const ctx = createContext(globalsFrom(cmd));
  try {
    await runHooksEvaluate(ctx, opts);
  } catch (e) {
    handleError(ctx, e);
  }
});

// Root --version / -V (avoid commander built-in --version, which conflicts with publish --version <ver>)
const rootVersion = parseRootVersionArgs(process.argv.slice(2));
if (rootVersion) {
  const out = new Output({ json: rootVersion.json, noColor: true });
  if (rootVersion.json) out.printJson({ version: cliVersion() });
  else out.write(cliVersion());
  process.exitCode = 0;
} else {
  await program.parseAsync(process.argv);
}
