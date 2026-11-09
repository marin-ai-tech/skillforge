// Metrics dashboard, part A: per-artifact metrics, the overview board, visibility, CSV export.
// Requires `npm run build`.
// The "ablation_score …" scenario depends on the `ablation` evidence kind.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { startServer, api as rawApi, login, createUser, loadDir, toB64, FIXTURES, ADMIN_PASSWORD } from "./lib/client.mjs";

const servers = [];
after(async () => {
  for (const s of servers) await s.stop?.();
});

const skillFiles = loadDir(join(FIXTURES, "skill-standard"));
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml)$/i;
/** Files of skill `name`: base + a text addition + a non-text script (not part of token_cost). */
const files = (name, textPad = 0, scriptPad = 0) => {
  const base = skillFiles.map((f) => ({
    path: f.path.replace("pdf-tools", name),
    content: f.path.endsWith("SKILL.md") ? Buffer.from(f.content.toString("utf8").replace(/^name: pdf-tools$/m, `name: ${name}`)) : f.content,
  }));
  if (textPad) base.push({ path: `${name}/references/PAD.md`, content: Buffer.from("x".repeat(textPad)) });
  if (scriptPad) base.push({ path: `${name}/scripts/pad.py`, content: Buffer.from("#".repeat(scriptPad)) });
  return base;
};
const expectedCost = (list) => Math.ceil(list.filter((f) => TEXT_EXT.test(f.path)).reduce((n, f) => n + f.content.length, 0) / 4);
const HEX = (n) => n.toString(16).padStart(32, "0");
let keyN = 1;

let srv;
let base;
const U = {};
const auth = (who) => (who === "anon" ? {} : { cookie: U[who].cookie });
const api = (method, path, body, who = "admin") => rawApi(base, method, path, body, auth(who));
const A = (n) => `/api/v1/artifacts/skill/${n}`;

async function boot(env = {}) {
  const s = await startServer(env, { prefix: "skillforge-md-" });
  assert.ok(s.up, `server did not start: ${s.stderr}`);
  servers.push(s);
  return s;
}

async function publish(name, who = "alice", { version, textPad = 0, scriptPad = 0, extra = {} } = {}) {
  const r = await api("POST", "/api/v1/artifacts", { type: "skill", ...(version ? { version } : {}), files: toB64(files(name, textPad, scriptPad)), ...extra }, who);
  assert.equal(r.status, 201, `publish ${name}: ${JSON.stringify(r.data)}`);
  return r;
}
const activate = async (name) => assert.equal((await api("POST", `${A(name)}/transitions`, { to: "active", reason: "go" }, "rita")).status, 200);
const usage = async (name, who, uses, helped, version) => {
  const r = await api("POST", `${A(name)}/usage`, { uses, helped, ...(version ? { version } : {}) }, who);
  assert.equal(r.status, 201, `usage: ${JSON.stringify(r.data)}`);
};
const fact = async (name, who, verification) => {
  const r = await api("POST", "/api/v1/me/session-facts", { source: "claude-code", facts: [{ skill: name, session_key: HEX(keyN++), used_at: new Date().toISOString(), verification }] }, who);
  assert.equal(r.data.accepted, 1, JSON.stringify(r.data));
};
const metrics = async (name, who = "alice") => (await api("GET", `${A(name)}/metrics`, undefined, who)).data;
const overview = (qs = "", who = "admin") => api("GET", `/api/v1/metrics/overview${qs ? `?${qs}` : ""}`, undefined, who);
const namesOf = (r) => r.data.items.map((i) => i.name);

/** Minimal CSV parsing (RFC 4180): quotes, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

before(async () => {
  const s = await boot({ SKILLFORGE_PUBLIC_READ: "true" });
  srv = s;
  base = s.base;
  U.admin = await login(base, "admin", ADMIN_PASSWORD);
  for (const [u, role] of [["alice", "contributor"], ["bob", "contributor"], ["rita", "reviewer"], ["lena", "contributor"], ["mia", "viewer"], ["oscar", "contributor"]]) {
    await createUser(base, U.admin.cookie, { username: u, password: `${u}-pw-123`, role });
    U[u] = await login(base, u, `${u}-pw-123`);
  }
});

test("artifact metrics: four indicators, token estimate from the text files of the latest version only, existing fields unchanged", async () => {
  const f1 = files("mx-card", 400, 5000);
  await publish("mx-card", "alice", { version: "0.1.0", textPad: 400, scriptPad: 5000 });
  const f2 = files("mx-card", 3000, 20000);
  await publish("mx-card", "alice", { version: "0.2.0", textPad: 3000, scriptPad: 20000 });
  await activate("mx-card");
  await usage("mx-card", "alice", 6, 5, "0.1.0");
  await usage("mx-card", "bob", 4, 3, "0.2.0");
  await fact("mx-card", "alice", "pass");
  await fact("mx-card", "alice", "pass");
  await fact("mx-card", "bob", "fail");

  const m = await metrics("mx-card");
  // existing fields and values
  assert.equal(m.sessions_count, 3);
  assert.equal(m.users_count, 2);
  assert.deepEqual(m.verification, { pass: 2, fail: 1, none: 0, pass_rate: 0.667 });
  assert.equal(m.skill_age_days, 0);
  // new
  assert.equal(m.uses, 10);
  assert.equal(m.helped, 8);
  assert.equal(m.transfer_rate, 0.8);
  const cost = expectedCost(f2);
  assert.notEqual(cost, expectedCost(f1), "the check distinguishes versions");
  assert.equal(m.token_cost, cost, "tokens are counted for the LATEST version and only for text files");
  assert.equal(m.token_efficiency, Math.round((0.8 / (cost / 1000)) * 1000) / 1000);
  assert.equal(m.token_cost_estimated, true);
  assert.equal(m.ablation_score, null, "no ablation reports");

  // no data: null, not zero
  await publish("mx-empty", "alice");
  const e = await metrics("mx-empty");
  assert.equal(e.uses, 0);
  assert.equal(e.transfer_rate, null);
  assert.equal(e.token_efficiency, null);
  assert.equal(e.ablation_score, null);
  assert.ok(e.token_cost > 0);
});

test("board: sorting, null last, totals, filters, pagination, parameter bounds, consistency with the card", async () => {
  for (const [n, uses, helped] of [["ovr-hi", 10, 9], ["ovr-mid", 10, 5], ["ovr-low", 10, 1]]) {
    await publish(n, "alice", { textPad: n === "ovr-hi" ? 4000 : 100 });
    await activate(n);
    await usage(n, "alice", uses, helped);
  }
  await publish("ovr-none", "alice"); // stays candidate, no data
  await publish("ovr-gone", "alice");
  await activate("ovr-gone");
  assert.equal((await api("POST", `${A("ovr-gone")}/transitions`, { to: "retired", reason: "not needed" }, "rita")).status, 200);

  const byRate = await overview("q=ovr-&sort=transfer_rate&order=desc");
  assert.equal(byRate.status, 200, JSON.stringify(byRate.data));
  assert.deepEqual(namesOf(byRate), ["ovr-hi", "ovr-mid", "ovr-low", "ovr-none"], "retired is hidden by default, null last");
  const asc = await overview("q=ovr-&sort=transfer_rate&order=asc");
  assert.deepEqual(namesOf(asc), ["ovr-low", "ovr-mid", "ovr-hi", "ovr-none"], "null last in ascending order too");
  assert.deepEqual(namesOf(await overview("q=ovr-&sort=name&order=asc")), ["ovr-hi", "ovr-low", "ovr-mid", "ovr-none"]);

  const t = byRate.data.totals;
  assert.equal(t.artifacts, 4);
  assert.deepEqual(t.by_status, { active: 3, candidate: 1 });
  assert.equal(t.uses, 30);
  assert.equal(t.helped, 15);
  assert.equal(t.transfer_rate, 0.5, "weighted: Σhelped/Σuses");
  assert.equal(t.with_ablation, 0);
  assert.equal(t.ablation_mean, null);
  assert.ok(Number.isFinite(t.median_token_cost) && t.median_token_cost > 0);

  // by tokens: hi has a higher weight, its efficiency per 1000 tokens is lower than mid's with the same ordering
  const byEff = await overview("q=ovr-&status=active&sort=token_efficiency&order=desc");
  const eff = Object.fromEntries(byEff.data.items.map((i) => [i.name, i.token_efficiency]));
  assert.ok(eff["ovr-mid"] > eff["ovr-low"], "mid is more efficient than low");
  assert.deepEqual(byEff.data.items.map((i) => i.status), ["active", "active", "active"], "status filter");

  const retired = await overview("q=ovr-&status=retired");
  assert.deepEqual(namesOf(retired), ["ovr-gone"], "explicit status=retired shows retired ones");

  // pagination
  const p1 = await overview("q=ovr-&sort=name&order=asc&limit=2");
  assert.deepEqual(namesOf(p1), ["ovr-hi", "ovr-low"]);
  assert.equal(p1.data.next_offset, 2);
  assert.equal(p1.data.totals.artifacts, 4, "totals cover the whole set, not the page");
  const p2 = await overview("q=ovr-&sort=name&order=asc&limit=2&offset=2");
  assert.deepEqual(namesOf(p2), ["ovr-mid", "ovr-none"]);
  assert.equal(p2.data.next_offset, null);

  // q: LIKE escaping and type
  assert.deepEqual(namesOf(await overview("q=ovr_")), [], "underscore is an ordinary character");
  assert.deepEqual(namesOf(await overview("q=%25")), [], "percent is an ordinary character");
  assert.deepEqual(namesOf(await overview("q=ovr-&type=command")), [], "type filter");

  // parameter bounds
  for (const bad of ["sort=owner", "sort=name;drop", "limit=0", "limit=201", "limit=x", "offset=-1", "status=ghost", "order=up", `q=${"a".repeat(65)}`, "type=nope"]) {
    const r = await overview(bad);
    assert.equal(r.status, 400, `${bad} -> ${r.status}`);
    assert.ok(["sort_invalid", "query_invalid"].includes(r.data.error), `${bad}: ${r.data.error}`);
  }

  // consistency of a board row and the card, set of fields, no user names
  const row = byRate.data.items.find((i) => i.name === "ovr-hi");
  const card = await metrics("ovr-hi");
  for (const [rowKey, cardKey] of [["transfer_rate", "transfer_rate"], ["uses", "uses"], ["ablation_score", "ablation_score"], ["token_cost", "token_cost"], ["token_efficiency", "token_efficiency"], ["skill_age_days", "skill_age_days"], ["sessions_count", "sessions_count"]]) {
    assert.equal(row[rowKey], card[cardKey], `${rowKey}: board and card differ`);
  }
  assert.equal(row.verification_pass_rate, card.verification.pass_rate);
  for (const k of ["type", "name", "display_name", "status", "owner_team", "latest_version", "skill_age_days", "sessions_count", "users_count", "last_used_at", "verification_pass_rate", "uses", "transfer_rate", "ablation_score", "token_cost", "token_efficiency"]) {
    assert.ok(k in row, `board row has no field ${k}`);
  }
  assert.equal(JSON.stringify(byRate.data).includes('"alice"'), false, "names of owners and report authors are not exposed");
});

test("visibility: a team artifact does not affect rows, totals and pagination for outsiders; a member and a reviewer see it", async () => {
  assert.equal((await api("POST", "/api/v1/teams", { name: "hush", lead: "lena" })).status, 201);
  assert.equal((await api("POST", "/api/v1/teams/hush/members", { username: "mia" }, "lena")).status, 201);
  await publish("vis-open", "alice");
  await publish("vis-secret", "lena", { extra: { visibility: "team", owner_team: "hush" } });
  for (const n of ["vis-open", "vis-secret"]) {
    await activate(n);
    await usage(n, "lena", 10, 7);
  }
  const seen = async (who) => {
    const r = await overview("q=vis-&sort=name&order=asc", who);
    assert.equal(r.status, 200, `${who}: ${JSON.stringify(r.data)}`);
    return r;
  };
  for (const who of ["oscar", "bob", "anon"]) {
    const r = await seen(who);
    assert.deepEqual(namesOf(r), ["vis-open"], `${who} must not see the team artifact`);
    assert.equal(r.data.totals.artifacts, 1, `${who}: totals count the invisible`);
    assert.equal(r.data.totals.uses, 10);
    assert.equal(r.data.totals.by_status.active, 1);
    const one = await overview("q=vis-&limit=1&sort=name&order=asc", who);
    assert.equal(one.data.next_offset, null, `${who}: next_offset reveals a hidden artifact`);
  }
  for (const who of ["mia", "lena", "rita", "admin"]) {
    const r = await seen(who);
    assert.deepEqual(namesOf(r), ["vis-open", "vis-secret"], `${who} must see both`);
    assert.equal(r.data.totals.artifacts, 2);
    assert.equal(r.data.totals.uses, 20);
  }
  assert.deepEqual(namesOf(await overview("q=vis-&team=hush", "oscar")), [], "the team filter does not reveal hidden items");
  assert.deepEqual(namesOf(await overview("q=vis-&team=hush", "mia")), ["vis-secret"]);

  const csvOf = async (who) => {
    const r = await fetch(`${base}/api/v1/metrics/export?format=csv&q=vis-`, { headers: who === "anon" ? {} : { cookie: U[who].cookie } });
    return { status: r.status, text: await r.text() };
  };
  const outsider = await csvOf("oscar");
  assert.equal(outsider.status, 200);
  assert.equal(outsider.text.includes("vis-secret"), false, "export reveals a team artifact to an outsider");
  assert.equal((await csvOf("mia")).text.includes("vis-secret"), true);
  const j = await api("GET", "/api/v1/metrics/export?format=json&q=vis-", undefined, "oscar");
  assert.equal(JSON.stringify(j.data).includes("vis-secret"), false);
});

test("a purged artifact is excluded from the board and totals", async () => {
  await publish("pur-a", "alice");
  await activate("pur-a");
  await usage("pur-a", "alice", 10, 10);
  const before = (await overview("q=pur-")).data.totals;
  assert.equal(before.artifacts, 1);
  const r = await api("POST", `${A("pur-a")}/purge`, { reason: "cleanup test", confirm: "skill/pur-a" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  for (const qs of ["q=pur-", "q=pur-&status=retired"]) {
    const after = await overview(qs);
    assert.deepEqual(namesOf(after), [], `purged must not be on the board (${qs})`);
    assert.equal(after.data.totals.artifacts, 0);
    assert.equal(after.data.totals.uses, 0);
  }
});

test("export: permissions, format, CSV without formula injections, limit and headers", async () => {
  await publish("csv-a", "alice");
  await activate("csv-a");
  await usage("csv-a", "alice", 8, 2);
  const inj = ["=HYPERLINK(\"http://x.example\",\"y\")", "+1+1", "-2+3", "@SUM(1,1)"];
  const names = ["csv-a"];
  for (const [i, title] of inj.entries()) {
    const n = `csv-i${i}`;
    await publish(n, "alice");
    await activate(n);
    const p = await api("PATCH", `${A(n)}/metadata`, { display_name: title }, "alice");
    assert.equal(p.status, 200, `metadata ${n}: ${JSON.stringify(p.data)}`);
    names.push(n);
  }
  await publish("csv-quote", "alice");
  await activate("csv-quote");
  assert.equal((await api("PATCH", `${A("csv-quote")}/metadata`, { display_name: 'Say "hi", ok' }, "alice")).status, 200);

  // permissions and format
  assert.equal((await api("GET", "/api/v1/metrics/export?format=csv", undefined, "anon")).status, 401);
  assert.equal((await api("GET", "/api/v1/metrics/export?format=xml", undefined, "alice")).status, 400);
  assert.equal((await api("GET", "/api/v1/metrics/export?format=xml", undefined, "alice")).data.error, "format_invalid");
  assert.equal((await api("GET", "/api/v1/metrics/export", undefined, "alice")).status, 400, "format is required");

  // JSON
  const j = await api("GET", "/api/v1/metrics/export?format=json&q=csv-", undefined, "alice");
  assert.equal(j.status, 200);
  assert.equal(j.data.truncated, false);
  assert.ok(typeof j.data.generated_at === "string" && Number.isFinite(Date.parse(j.data.generated_at)));
  assert.ok(Array.isArray(j.data.columns) && j.data.columns.includes("token_efficiency") && j.data.columns.includes("display_name"));
  assert.equal(j.data.items.length, 6);

  // CSV
  const res = await fetch(`${base}/api/v1/metrics/export?format=csv&q=csv-&sort=name&order=asc`, { headers: { cookie: U.alice.cookie } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/csv/);
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="skillforge-metrics-[^"]+\.csv"$/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const text = await res.text();
  assert.ok(text.includes("\r\n"), "rows are separated by CRLF");
  const rows = parseCsv(text);
  assert.deepEqual(rows[0], j.data.columns, "the first row is the columns");
  const col = (r, name) => r[j.data.columns.indexOf(name)];
  const body = rows.slice(1).filter((r) => r.length > 1);
  assert.equal(body.length, 6);
  const byName = Object.fromEntries(body.map((r) => [col(r, "name"), r]));
  assert.equal(col(byName["csv-i0"], "display_name"), `'=HYPERLINK("http://x.example","y")`, "formula is neutralized, quotes are doubled and restored by parsing");
  assert.equal(col(byName["csv-i1"], "display_name"), "'+1+1");
  assert.equal(col(byName["csv-i2"], "display_name"), "'-2+3");
  assert.equal(col(byName["csv-i3"], "display_name"), "'@SUM(1,1)");
  assert.equal(col(byName["csv-quote"], "display_name"), 'Say "hi", ok', "comma and quotes do not break the row");
  assert.equal(col(byName["csv-a"], "transfer_rate"), "0.25", "numbers unchanged");
  assert.equal(col(byName["csv-a"], "ablation_score"), "", "null is an empty cell");
  // a numeric cell with a negative value gets no prefix — there are no negatives here; check that ordinary numbers have no quote prefixes
  assert.equal(/^'/.test(col(byName["csv-a"], "uses")), false);
  assert.equal(text.includes('"=HYPERLINK'), false, "the file has no unprefixed formula at the start of a cell");
});

test("public read is off: the board requires login", async () => {
  const s = await boot({ SKILLFORGE_PUBLIC_READ: "false" });
  const admin = await login(s.base, "admin", ADMIN_PASSWORD);
  assert.equal((await rawApi(s.base, "GET", "/api/v1/metrics/overview", undefined, {})).status, 401);
  assert.equal((await rawApi(s.base, "GET", "/api/v1/metrics/overview", undefined, { cookie: admin.cookie })).status, 200);
});

test("ablation_score: the latest ablation report of an artifact goes to the card, board, totals and export", async () => {
  await publish("abl-a", "alice", { version: "0.1.0" });
  await activate("abl-a");
  await publish("abl-b", "alice");
  await activate("abl-b");
  const post = (name, data) => api("POST", `${A(name)}/versions/0.1.0/evidence`, { kind: "ablation", url: `https://runs.example/${name}/${keyN++}`, data }, "alice");
  assert.equal((await post("abl-a", { tasks: 20, passed_with: 16, passed_without: 10 })).status, 201);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await post("abl-a", { tasks: 20, passed_with: 9, passed_without: 12 })).status, 201);
  assert.equal((await post("abl-b", { tasks: 10, passed_with: 8, passed_without: 4 })).status, 201);

  assert.equal((await metrics("abl-a")).ablation_score, -0.15, "the LATEST report by time is used; a negative value is allowed");
  assert.equal((await metrics("abl-b")).ablation_score, 0.4);
  const o = await overview("q=abl-&sort=ablation_score&order=desc");
  assert.deepEqual(namesOf(o), ["abl-b", "abl-a"]);
  assert.equal(o.data.totals.with_ablation, 2);
  assert.equal(o.data.totals.ablation_mean, 0.125, "mean over artifacts: (0.4 − 0.15) / 2");
  const res = await fetch(`${base}/api/v1/metrics/export?format=csv&q=abl-&sort=name&order=asc`, { headers: { cookie: U.alice.cookie } });
  const rows = parseCsv(await res.text());
  const idx = rows[0].indexOf("ablation_score");
  assert.equal(rows[1][idx], "-0.15", "negative number without an apostrophe prefix");
  assert.equal(rows[2][idx], "0.4");
});

test("performance: a board of 40 artifacts answers without a query per artifact (rough time bound)", async () => {
  for (let i = 0; i < 40; i++) {
    const n = `perf-${String(i).padStart(2, "0")}`;
    await publish(n, "alice");
    await activate(n);
    await usage(n, "alice", 10, i % 11);
  }
  const t0 = Date.now();
  const r = await overview("q=perf-&limit=200");
  const dt = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.equal(r.data.items.length, 40);
  assert.ok(dt < 3000, `board took ${dt} ms`);
});
