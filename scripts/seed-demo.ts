/**
 * Demo seed for local SkillForge (npm run seed:demo).
 *
 * Idempotent exists/skip strategy via getUserByUsername / getArtifactByTypeName /
 * getTeamByName and stable comment ref / usage report_id.
 *
 * Compatible with npm run local:reset: reset removes the data dir; next local:start
 * re-bootstraps admin via seedAdmin; then seed:demo fills demo users/team/artifacts.
 * Honors SKILLFORGE_DATA_DIR (default ./data), same as scripts/local-start.*.
 *
 * LOCAL ONLY — demo passwords are for local/dev stands, never for production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate, type Database } from "../packages/server/dist/db.js";
import {
  countUsers,
  createUser,
  getUserByUsername,
  type Role,
} from "../packages/server/dist/auth/users.js";
import { publishArtifact } from "../packages/server/dist/publish.js";
import { getArtifactByTypeName } from "../packages/server/dist/repo.js";
import { getTeamByName } from "../packages/server/dist/teams.js";
import { transitionArtifact } from "../packages/server/dist/lifecycle/transitions.js";
import { recordUsage } from "../packages/server/dist/evidence/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const DEMO_PASSWORD_DEFAULT = "demo-pass-1";
const COMMENT_REF = "demo-seed-comment-1";
const USAGE_REPORT_ID = "demo-seed-usage-1";

type SummaryLine = { action: "created" | "exists" | "skipped"; kind: string; name: string };

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

function resolveDataDir(): string {
  const fromEnv = process.env.SKILLFORGE_DATA_DIR;
  if (fromEnv && fromEnv.trim() !== "") {
    return path.resolve(fromEnv);
  }
  return path.resolve(REPO_ROOT, "data");
}

function isDbLockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /SQLITE_BUSY|database is locked|locked/i.test(msg);
}

function ensureUser(
  db: Database,
  username: string,
  role: Role,
  password: string,
  summary: SummaryLine[],
): void {
  const existing = getUserByUsername(db, username);
  if (existing) {
    summary.push({ action: "exists", kind: "user", name: `${username} (${role})` });
    return;
  }
  const result = createUser(db, {
    username,
    password,
    role,
    display_name: username,
  });
  if (!result.ok) {
    throw new Error(`failed to create user ${username}: ${result.error}`);
  }
  summary.push({ action: "created", kind: "user", name: `${username} (${role})` });
}

function ensureTeamAlpha(db: Database, actor: string, summary: SummaryLine[]): void {
  const existing = getTeamByName(db, "alpha");
  const now = new Date().toISOString();
  if (!existing) {
    const id = randomUUID();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO teams (id, name, display_name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, "alpha", "Alpha", "Demo team alpha", actor, now);
      db.prepare(
        "INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, 'lead', ?, ?)",
      ).run(id, "dev1", actor, now);
      db.prepare(
        "INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, 'member', ?, ?)",
      ).run(id, "viewer1", actor, now);
      db.exec("COMMIT");
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    }
    summary.push({ action: "created", kind: "team", name: "alpha (lead=dev1, member=viewer1)" });
    return;
  }

  summary.push({ action: "exists", kind: "team", name: "alpha" });
  const members = db
    .prepare("SELECT username, role FROM team_members WHERE team_id = ?")
    .all(existing.id) as Array<{ username: string; role: string }>;
  const byUser = new Map(members.map((m) => [m.username, m.role]));

  if (!byUser.has("dev1")) {
    db.prepare(
      "INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, 'lead', ?, ?)",
    ).run(existing.id, "dev1", actor, now);
    summary.push({ action: "created", kind: "team_member", name: "alpha/dev1 lead" });
  } else {
    summary.push({ action: "skipped", kind: "team_member", name: "alpha/dev1" });
  }
  if (!byUser.has("viewer1")) {
    db.prepare(
      "INSERT INTO team_members (team_id, username, role, added_by, added_at) VALUES (?, ?, 'member', ?, ?)",
    ).run(existing.id, "viewer1", actor, now);
    summary.push({ action: "created", kind: "team_member", name: "alpha/viewer1 member" });
  } else {
    summary.push({ action: "skipped", kind: "team_member", name: "alpha/viewer1" });
  }
}

type DemoArtifact = {
  type: "skill" | "command" | "agent" | "hook" | "plugin" | "settings";
  name: string;
  body: {
    type: string;
    name?: string;
    description?: string;
    files: Array<{ path: string; content_base64: string }>;
  };
};

function demoArtifacts(): DemoArtifact[] {
  const skillMd =
    "---\nname: demo-skill\ndescription: Demo skill for local SkillForge seeding.\n---\n\n# Demo Skill\n\nLocal-only demo skill body.\n";
  const commandMd =
    "---\ndescription: Demo command for local SkillForge seeding.\n---\n\nRun the demo command workflow.\n";
  const agentMd =
    "---\nname: demo-agent\ndescription: Demo agent for local SkillForge seeding.\ntools: Bash, Read\n---\n\nYou are a demo agent used only for local seeding.\n";
  const hooksJson = JSON.stringify(
    {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "prompt", prompt: "Confirm demo hook fired (local seed only)." }],
          },
        ],
      },
    },
    null,
    2,
  );
  const pluginManifest = JSON.stringify(
    {
      name: "demo-plugin",
      description: "Demo plugin for local SkillForge seeding.",
      version: "0.1.0",
    },
    null,
    2,
  );
  const nestedSkill =
    "---\nname: demo-plugin-skill\ndescription: Nested skill inside demo-plugin.\n---\n\n# Nested demo skill\n\nBody for plugin component.\n";
  const settingsMd =
    "---\nname: demo-settings\ndescription: Demo settings profile for local SkillForge seeding.\nruntime: claude-code\nscope: project\n---\n\n# Demo Settings\n\nLocal-only settings profile.\n";
  const settingsJson = JSON.stringify({ model: "sonnet", includeCoAuthoredBy: false }, null, 2);

  return [
    {
      type: "skill",
      name: "demo-skill",
      body: {
        type: "skill",
        files: [{ path: "SKILL.md", content_base64: b64(skillMd) }],
      },
    },
    {
      type: "command",
      name: "demo-command",
      body: {
        type: "command",
        files: [{ path: "demo-command.md", content_base64: b64(commandMd) }],
      },
    },
    {
      type: "agent",
      name: "demo-agent",
      body: {
        type: "agent",
        files: [{ path: "demo-agent.md", content_base64: b64(agentMd) }],
      },
    },
    {
      type: "hook",
      name: "demo-hook",
      body: {
        type: "hook",
        name: "demo-hook",
        description: "Demo hook for local SkillForge seeding.",
        files: [{ path: "hooks.json", content_base64: b64(hooksJson) }],
      },
    },
    {
      type: "plugin",
      name: "demo-plugin",
      body: {
        type: "plugin",
        files: [
          { path: ".claude-plugin/plugin.json", content_base64: b64(pluginManifest) },
          { path: "skills/demo-plugin-skill/SKILL.md", content_base64: b64(nestedSkill) },
        ],
      },
    },
    {
      type: "settings",
      name: "demo-settings",
      body: {
        type: "settings",
        files: [
          { path: "SETTINGS.md", content_base64: b64(settingsMd) },
          { path: "settings.json", content_base64: b64(settingsJson) },
        ],
      },
    },
  ];
}

function ensureArtifacts(
  db: Database,
  dataDir: string,
  actor: string,
  summary: SummaryLine[],
): void {
  const ctx = { db, dataDir, actor, role: "admin" as const };
  for (const art of demoArtifacts()) {
    const existing = getArtifactByTypeName(db, art.type, art.name);
    if (existing) {
      summary.push({ action: "exists", kind: "artifact", name: `${art.type}/${art.name}` });
      if (existing.status === "candidate") {
        const tr = transitionArtifact(db, {
          type: art.type,
          name: art.name,
          to: "active",
          actor,
          actorRole: "admin",
          reason: "demo-seed promote to active",
        });
        if (tr.ok) {
          summary.push({
            action: "created",
            kind: "status",
            name: `${art.type}/${art.name} -> active`,
          });
        } else {
          summary.push({ action: "skipped", kind: "status", name: `${art.type}/${art.name}` });
        }
      }
      continue;
    }

    const published = publishArtifact(ctx, art.body);
    if (published.kind !== "created") {
      const detail =
        published.kind === "validation_failed"
          ? JSON.stringify(published.errors)
          : published.kind === "bad_request"
            ? published.message
            : published.kind;
      throw new Error(`failed to publish ${art.type}/${art.name}: ${detail}`);
    }
    summary.push({ action: "created", kind: "artifact", name: `${art.type}/${art.name}` });

    const tr = transitionArtifact(db, {
      type: art.type,
      name: art.name,
      to: "active",
      actor,
      actorRole: "admin",
      reason: "demo-seed promote to active",
    });
    if (!tr.ok) {
      throw new Error(`failed to activate ${art.type}/${art.name}: ${JSON.stringify(tr.body)}`);
    }
    summary.push({
      action: "created",
      kind: "status",
      name: `${art.type}/${art.name} -> active`,
    });
  }
}

function ensureComment(db: Database, summary: SummaryLine[]): void {
  const artifact = getArtifactByTypeName(db, "skill", "demo-skill");
  if (!artifact) {
    throw new Error("demo-skill missing; cannot seed comment");
  }
  const prior = db
    .prepare("SELECT id FROM comments WHERE artifact_id = ? AND ref = ?")
    .get(artifact.id, COMMENT_REF) as { id: string } | undefined;
  if (prior) {
    summary.push({ action: "exists", kind: "comment", name: COMMENT_REF });
    return;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO comments (id, artifact_id, version, parent_id, author, body, ref, mentions, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    artifact.id,
    artifact.latest_version,
    "dev1",
    "Demo seed comment (local only). Stable ref for exists/skip.",
    COMMENT_REF,
    "[]",
    now,
  );
  summary.push({ action: "created", kind: "comment", name: COMMENT_REF });
}

function ensureUsage(db: Database, summary: SummaryLine[]): void {
  const result = recordUsage(db, {
    type: "skill",
    name: "demo-skill",
    reporter: "dev1",
    source: "demo-seed",
    report: {
      version: null,
      uses: 1,
      helped: 1,
      source: "demo-seed",
      report_id: USAGE_REPORT_ID,
    },
  });
  if (result.kind === "not_found") {
    throw new Error("demo-skill missing; cannot seed usage");
  }
  if (result.kind === "rate_limited") {
    summary.push({ action: "skipped", kind: "usage", name: USAGE_REPORT_ID });
    return;
  }
  if (result.kind === "duplicate") {
    summary.push({ action: "exists", kind: "usage", name: USAGE_REPORT_ID });
    return;
  }
  summary.push({ action: "created", kind: "usage", name: USAGE_REPORT_ID });
}

function printSummary(summary: SummaryLine[]): void {
  console.log("seed:demo summary (created / exists / skipped):");
  for (const line of summary) {
    console.log(`  [${line.action}] ${line.kind}: ${line.name}`);
  }
}

function main(): void {
  console.log("WARNING: seed:demo is LOCAL ONLY. Demo passwords must not be used in production.");
  // Hard guards: never run in a deployed context and never create
  // the sole admin with a well-known password — first start (local:start)
  // bootstraps admin via seedAdmin with a generated/explicit password.
  if (process.env.NODE_ENV === "production") {
    console.error("ERROR: seed:demo refuses to run with NODE_ENV=production.");
    process.exit(1);
  }
  const password =
    process.env.SEED_DEMO_PASSWORD && process.env.SEED_DEMO_PASSWORD.length >= 8
      ? process.env.SEED_DEMO_PASSWORD
      : DEMO_PASSWORD_DEFAULT;

  const dataDir = resolveDataDir();
  console.log(`Data dir: ${dataDir} (SKILLFORGE_DATA_DIR or ./data; compatible with local:reset)`);

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let db: Database;
  try {
    db = openDatabase(dataDir);
    migrate(db);
  } catch (e) {
    if (isDbLockedError(e)) {
      console.error(
        "ERROR: database is locked. Stop the SkillForge server (npm run local:stop) and retry seed:demo.",
      );
      process.exit(1);
    }
    throw e;
  }

  if (countUsers(db) === 0) {
    console.error(
      "ERROR: no users in the database — run `npm run local:start` first; it bootstraps " +
        "the admin account with a generated/explicit password. seed:demo must not create " +
        "the only admin with a well-known demo password.",
    );
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(1);
  }

  const summary: SummaryLine[] = [];
  try {
    // Four roles: admin, reviewer, contributor, viewer (users admin / rev1 / dev1 / viewer1)
    ensureUser(db, "admin", "admin", password, summary);
    ensureUser(db, "rev1", "reviewer", password, summary);
    ensureUser(db, "dev1", "contributor", password, summary);
    ensureUser(db, "viewer1", "viewer", password, summary);

    ensureTeamAlpha(db, "admin", summary);
    ensureArtifacts(db, dataDir, "admin", summary);
    ensureComment(db, summary);
    ensureUsage(db, summary);

    printSummary(summary);
    console.log("seed:demo complete (exit 0). Re-run is safe (exists/skip).");
  } catch (e) {
    if (isDbLockedError(e)) {
      console.error(
        "ERROR: database is locked. Stop the SkillForge server (npm run local:stop) and retry seed:demo.",
      );
      process.exit(1);
    }
    console.error("seed:demo failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

main();
