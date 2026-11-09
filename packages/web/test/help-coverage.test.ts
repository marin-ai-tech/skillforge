import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ISSUE_CODES, QUALITY_CODES } from "@skillforge/core";
import { ROUTES } from "../src/app/routes.ts";
import { ACTIONS, ACTION_HELP, PAGE_HELP } from "../src/help/registry.ts";
import { parseFrontmatter } from "../src/lib/frontmatter-lite.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const topicsRoot = path.resolve(__dirname, "../src/help/topics");

const FIXED_PAGE_TITLES: Record<string, string> = {
  "pages/home": "Home",
  "pages/catalog": "Catalog",
  "pages/artifact": "Artifact page",
  "pages/lifecycle": "Lifecycle board",
  "pages/publish": "Publishing an artifact",
  "pages/import": "Importing artifacts",
  "pages/login": "Sign in",
  "pages/users": "Users administration",
  "pages/tokens": "API tokens",
  "pages/password": "Changing your password",
  "pages/help": "Help center",
  "pages/not-found": "Page not found",
};

function listTopicFiles(): string[] {
  const out: string[] = [];
  function walk(dir: string) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".md")) out.push(full);
    }
  }
  walk(topicsRoot);
  return out;
}

function fileToId(full: string): string {
  const rel = path.relative(topicsRoot, full).split(path.sep).join("/");
  return rel.replace(/\.md$/, "");
}

describe("help coverage", () => {
  const files = listTopicFiles();
  const ids = new Set(files.map(fileToId));
  const byId = new Map(
    files.map((f) => {
      const id = fileToId(f);
      const raw = fs.readFileSync(f, "utf8");
      const parsed = parseFrontmatter(raw);
      return [id, parsed] as const;
    }),
  );

  it("every ROUTES entry has PAGE_HELP topic", () => {
    for (const route of ROUTES) {
      const topicId = PAGE_HELP[route];
      assert.ok(topicId, `PAGE_HELP missing for route ${route}`);
      assert.ok(ids.has(topicId), `topic ${topicId} for route ${route} does not exist`);
    }
  });

  it("every PAGE_HELP key is a ROUTES entry", () => {
    for (const route of Object.keys(PAGE_HELP)) {
      assert.ok(
        (ROUTES as readonly string[]).includes(route),
        `PAGE_HELP has unknown route ${route}`,
      );
    }
  });

  it("every ACTION has non-empty tip in ACTION_HELP", () => {
    for (const action of ACTIONS) {
      const entry = ACTION_HELP[action];
      assert.ok(entry, `ACTION_HELP missing for ${action}`);
      assert.ok(entry.tip && entry.tip.trim().length > 0, `empty tip for ${action}`);
    }
  });

  it("every ISSUE_CODES has codes/<CODE>.md", () => {
    for (const code of Object.keys(ISSUE_CODES)) {
      const id = `codes/${code}`;
      assert.ok(ids.has(id), `missing topic file for ${id}`);
    }
  });

  it("every QUALITY_CODES has codes/<CODE>.md", () => {
    for (const code of Object.keys(QUALITY_CODES)) {
      const id = `codes/${code}`;
      assert.ok(ids.has(id), `missing topic file for ${id}`);
    }
  });

  it("all related and registry topic refs resolve", () => {
    for (const [id, doc] of byId) {
      const related = doc.data.related ?? [];
      for (const rel of related) {
        assert.ok(ids.has(rel), `related ${rel} from ${id} does not exist`);
      }
    }
    for (const topicId of Object.values(PAGE_HELP)) {
      assert.ok(ids.has(topicId), `PAGE_HELP topic ${topicId} missing`);
    }
    for (const action of ACTIONS) {
      const topic = ACTION_HELP[action].topic;
      if (topic) assert.ok(ids.has(topic), `ACTION_HELP topic ${topic} for ${action} missing`);
    }
  });

  it("page topic titles match fixed strings", () => {
    for (const [id, title] of Object.entries(FIXED_PAGE_TITLES)) {
      const doc = byId.get(id);
      assert.ok(doc, `missing page topic ${id}`);
      assert.equal(doc.data.title, title, `title mismatch for ${id}`);
    }
  });

  const CONTENT_STANDARD: Record<string, { minWords: number; headings: string[] }> = {
    pages: {
      minWords: 150,
      headings: ["What this page is for", "What you see", "Common tasks", "Permissions"],
    },
    "getting-started": { minWords: 200, headings: [] },
    codes: {
      minWords: 70,
      headings: ["What it means", "Common causes", "How to fix"],
    },
    actions: {
      minWords: 40,
      headings: ["What it does", "When to use", "Requires"],
    },
    shortcuts: { minWords: 60, headings: [] },
  };

  function topicArea(id: string): string {
    return id.split("/")[0] ?? "";
  }

  function countWords(body: string): number {
    return body.split(/\s+/).filter(Boolean).length;
  }

  function headingTitles(body: string): string[] {
    return [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  }

  it("topic quality floor: min words and required sections", () => {
    const failures: string[] = [];
    for (const [id, doc] of byId) {
      const area = topicArea(id);
      const rule = CONTENT_STANDARD[area];
      if (!rule) continue;
      const words = countWords(doc.body);
      if (words < rule.minWords) {
        failures.push(`${id}: ${words} words < ${rule.minWords} (quality floor)`);
      }
      const headings = headingTitles(doc.body);
      for (const h of rule.headings) {
        if (!headings.some((x) => x.toLowerCase().startsWith(h.toLowerCase()))) {
          failures.push(`${id}: missing required section "## ${h}"`);
        }
      }
      if (!doc.data.title) {
        failures.push(`${id}: missing title in frontmatter`);
      }
    }
    assert.deepEqual(
      failures,
      [],
      `help topic quality floor failures:\n  ${failures.join("\n  ")}`,
    );
  });

  it("codes topics include fence example and Blocking/Warning severity", () => {
    const failures: string[] = [];
    for (const [id, doc] of byId) {
      if (!id.startsWith("codes/")) continue;
      if (!/```/.test(doc.body)) {
        failures.push(`${id}: missing code fence with fix example`);
      }
      const code = id.slice("codes/".length);
      const expect = code.startsWith("E_")
        ? "Blocking"
        : code.startsWith("Q_")
          ? "Advisory"
          : "Warning";
      if (!doc.body.includes(expect)) {
        failures.push(`${id}: missing severity word "${expect}"`);
      }
    }
    assert.deepEqual(failures, [], `codes quality failures:\n  ${failures.join("\n  ")}`);
  });

  it("versions-and-digests title is exact", () => {
    const doc = byId.get("getting-started/versions-and-digests");
    assert.ok(doc);
    assert.equal(doc.data.title, "Versions and digests");
  });
});
