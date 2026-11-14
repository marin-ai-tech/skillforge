// sdlc-registry: the sdlc team registry (`team.registry` in sdlc.yaml) answered on SkillForge's own /mcp.
// Contract: the answers of the field-test adapter (sdlc 0.32.0) — roles are agents tagged `sdlc-role`, skills and
// rules are SkillForge artifacts, checksums are sdlc's. Every read goes through `call.registry` as the calling token,
// so sdlc sees exactly what that token may; ctx.registry only lists candidate names, which are then checked as the
// caller. Process events (`report_outcome`) are for integration tokens only and become `assigned` usage reports.
import { createHash } from "node:crypto";

const ROLE_TAG = "sdlc-role";
const PAGE = 200;

const sha = (text) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

function scalar(raw) {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (/^".*"$/.test(item) ? JSON.parse(item) : item.replace(/^'(.*)'$/, "$1")));
  }
  if (raw.startsWith('"')) return JSON.parse(raw);
  if (raw === "true" || raw === "false") return raw === "true";
  return raw;
}

/** A flat front matter block: `key: value` lines, `[a, b]` or `- item` lists, quoted strings (as the adapter). */
function frontMatter(text) {
  const normal = text.replace(/\r\n/g, "\n");
  const match = normal.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { fields: {}, body: normal };
  const fields = {};
  let listKey;
  for (const line of match[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) {
      fields[listKey].push(scalar(item[1].trim()));
      continue;
    }
    const at = line.indexOf(":");
    if (at < 1 || /^\s/.test(line)) continue;
    const key = line.slice(0, at).trim();
    const raw = line.slice(at + 1).trim();
    listKey = raw === "" ? key : undefined;
    fields[key] = raw === "" ? [] : scalar(raw);
  }
  return { fields, body: normal.slice(match[0].length) };
}

const list = (v) => (Array.isArray(v) ? v : []);

function idOf(args) {
  if (!args || typeof args.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(args.id)) {
    throw new Error("id must be a kebab-case artifact name");
  }
  return args.id;
}

/** Sha256 hex of the bytes the registry listed for a file, checked against what was read. */
function checkFile(id, listed, bytes) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== listed.sha256)
    throw new Error(`${id}: ${listed.path} does not match the sha256 the registry listed`);
}

export async function register(ctx) {
  /** Active artifacts of a type the caller can see: names from ctx.registry, each confirmed as the caller. */
  async function visible(call, type, keep = () => true) {
    const out = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = ctx.registry.listArtifacts({ type, status: "active", limit: PAGE, offset });
      for (const a of page.items) {
        if (!keep(a)) continue;
        try {
          out.push(await call.registry("get_artifact", { type, name: a.name }));
        } catch {
          // not visible to this token: skip without saying so
        }
      }
      if (page.items.length < PAGE) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
  const isRole = (a) => list(a.tags).includes(ROLE_TAG);

  async function role(call, id) {
    const summary = ctx.registry.getArtifact("agent", id);
    const artifact = await call.registry("get_artifact", { type: "agent", name: id });
    if (!summary || !isRole(summary))
      throw new Error(`${id} is not an sdlc role (an agent tagged ${ROLE_TAG})`);
    const listed = artifact.files.find((f) => f.path === artifact.main_file.path);
    if (!listed) throw new Error(`${id}: the main file is not in the file list`);
    checkFile(id, listed, Buffer.from(artifact.main_file.text, "utf8"));
    const { fields, body } = frontMatter(artifact.main_file.text);
    return {
      id,
      version: artifact.version,
      title: fields.title ?? id,
      description: fields.description ?? artifact.description,
      stages: list(fields.stages),
      tools: list(fields.tools),
      readonly: fields.readonly !== false,
      skills: list(fields.skills),
      body,
      checksum: sha(body),
      marker: { key: "skillforge-source", value: `agent/${id}@${artifact.version}` },
    };
  }

  async function skill(call, id) {
    const artifact = await call.registry("get_artifact", { type: "skill", name: id });
    const read = await call.registry("read_artifact_files", {
      type: "skill",
      name: id,
      version: artifact.version,
    });
    const byPath = new Map(read.files.map((f) => [f.path, f]));
    for (const o of read.omitted) {
      byPath.set(
        o.path,
        await call.registry("read_artifact_file", {
          type: "skill",
          name: id,
          path: o.path,
          version: artifact.version,
        }),
      );
    }
    const prefix = `skills/${id}/`;
    const files = [];
    for (const listed of artifact.files) {
      const f = byPath.get(listed.path);
      if (!f) throw new Error(`${id}: ${listed.path} could not be read`);
      if (f.encoding !== "utf-8")
        throw new Error(`${id}: ${listed.path} is binary; sdlc takes text files only`);
      checkFile(id, listed, Buffer.from(f.text, "utf8"));
      files.push({
        path: listed.path.startsWith(prefix) ? listed.path.slice(prefix.length) : listed.path,
        content: f.text,
      });
    }
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, "en"));
    const checksum = sha(sorted.map((f) => `${f.path}\n${f.content}\n`).join(""));
    return { id, version: artifact.version, title: artifact.description, files, checksum };
  }

  async function rule(call, id) {
    const artifact = await call.registry("get_artifact", { type: "rule", name: id });
    const listed = artifact.files.find((f) => f.path === artifact.main_file.path);
    if (!listed) throw new Error(`${id}: the main file is not in the file list`);
    checkFile(id, listed, Buffer.from(artifact.main_file.text, "utf8"));
    const { fields, body } = frontMatter(artifact.main_file.text);
    const paths = list(fields.paths).length > 0 ? list(fields.paths) : undefined;
    return {
      id,
      version: artifact.version,
      title: id,
      description: fields.description ?? artifact.description,
      tags: list(fields.tags),
      ...(paths ? { paths } : {}),
      body,
      checksum: sha(body),
    };
  }

  /** `gate.<stage>.<outcome>` or `verify.<outcome>`: the stage and whether the work was accepted. */
  function stageOf(name) {
    const m = /^gate\.([a-z][a-z0-9-]*)\.([a-z]+)$/.exec(name) ?? /^(verify)\.([a-z]+)$/.exec(name);
    if (!m) return null;
    const helped = /^(approved|passed)$/.test(m[2])
      ? 1
      : /^(rejected|rework|failed)$/.test(m[2])
        ? 0
        : undefined;
    return helped === undefined ? null : { stage: m[1], helped };
  }

  /** Skills of the visible roles whose `stages` include the stage. */
  async function stageSkills(call, stage) {
    const skills = new Set();
    for (const r of await visible(call, "agent", isRole)) {
      const { fields } = frontMatter(r.main_file.text);
      if (!list(fields.stages).includes(stage)) continue;
      for (const s of list(fields.skills)) skills.add(s);
    }
    return [...skills].sort();
  }

  async function reportOne(call, eventId, skill, helped) {
    const args = {
      type: "skill",
      name: skill,
      uses: 1,
      helped,
      basis: "assigned",
      report_id: `${eventId}-${skill}`.slice(0, 128),
    };
    try {
      const r = await call.registry("record_usage", args);
      return { skill, version: r?.version ?? null, helped };
    } catch (e) {
      return { skill, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function reportOutcome(call, args) {
    const event = args?.event;
    const name = typeof event?.event === "string" ? event.event : "";
    const outcome = stageOf(name);
    if (!outcome || typeof event.id !== "string" || event.id === "")
      return { event: name, reported: [], skipped: name || "no event" };
    const reported = [];
    for (const s of await stageSkills(call, outcome.stage)) {
      reported.push(await reportOne(call, event.id, s, outcome.helped));
    }
    return { event: name, reported };
  }

  const NONE = { type: "object", properties: {}, additionalProperties: false };
  const BY_ID = (what) => ({
    type: "object",
    properties: {
      id: { type: "string", description: `the ${what} id from the list call` },
      locale: { type: "string", description: "optional locale, e.g. en" },
    },
    required: ["id"],
  });
  const tool = (name, description, inputSchema, handler, audience) =>
    ctx.mcp.tool({ name, description, inputSchema, ...(audience ? { audience } : {}) }, handler);

  tool(
    "list_roles",
    "sdlc team registry: roles (SkillForge agents tagged sdlc-role)",
    NONE,
    async (_a, call) => ({
      roles: (await visible(call, "agent", isRole)).map((a) => ({
        id: a.name,
        version: a.version,
      })),
    }),
  );
  tool(
    "get_role",
    "sdlc team registry: one role with its body and checksum",
    BY_ID("role"),
    (a, call) => role(call, idOf(a)),
  );
  tool("list_skills", "sdlc team registry: active SkillForge skills", NONE, async (_a, call) => ({
    skills: (await visible(call, "skill")).map((a) => ({
      id: a.name,
      version: a.version,
      title: a.description,
    })),
  }));
  tool(
    "get_skill",
    "sdlc team registry: one skill with all its files and checksum",
    BY_ID("skill"),
    (a, call) => skill(call, idOf(a)),
  );
  tool("list_rules", "sdlc team registry: active SkillForge rules", NONE, async (_a, call) => {
    const rules = [];
    for (const a of await visible(call, "rule")) {
      const r = await rule(call, a.name);
      rules.push({
        id: r.id,
        version: r.version,
        tags: r.tags,
        ...(r.paths ? { paths: r.paths } : {}),
        checksum: r.checksum,
      });
    }
    return { rules };
  });
  tool(
    "get_rule",
    "sdlc team registry: one rule with its body, paths, tags and checksum",
    BY_ID("rule"),
    (a, call) => rule(call, idOf(a)),
  );
  tool(
    "report_outcome",
    "sdlc event receiver: an approved or rejected stage becomes assigned usage of the skills of that stage's roles",
    { type: "object", additionalProperties: true },
    (a, call) => reportOutcome(call, a),
    "integration",
  );
}
