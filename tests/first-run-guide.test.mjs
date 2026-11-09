// Acceptance tests: first run guide.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/client.mjs";

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function findStartPageModule() {
  const candidates = [
    "packages/web/src/pages/Start.tsx",
    "packages/web/src/pages/StartGuide.tsx",
    "packages/web/src/pages/FirstRun.tsx",
    "packages/web/src/pages/FirstRunGuide.tsx",
  ];
  for (const rel of candidates) {
    if (existsSync(join(ROOT, rel))) return { rel, src: read(rel) };
  }
  const pagesDir = join(ROOT, "packages", "web", "src", "pages");
  if (!existsSync(pagesDir)) return null;
  for (const name of readdirSync(pagesDir)) {
    if (!/\.(tsx|jsx|ts|js)$/.test(name)) continue;
    if (!/start|firstrun|first-run|getting.?started/i.test(name)) continue;
    const rel = `packages/web/src/pages/${name}`;
    return { rel, src: read(rel) };
  }
  return null;
}

function routerSources() {
  const files = [
    "packages/web/src/App.tsx",
    "packages/web/src/app/router.tsx",
    "packages/web/src/app/routes.ts",
    "packages/web/src/main.tsx",
  ];
  const parts = [];
  for (const rel of files) {
    if (existsSync(join(ROOT, rel))) parts.push({ rel, src: read(rel) });
  }
  return parts;
}

function startRouteWired(routerFiles) {
  const combined = routerFiles.map((f) => f.src).join("\n");
  // path "start" or "/start" in router/ROUTES, or import of Start page
  const pathWired =
    /path\s*:\s*["']start["']/.test(combined) ||
    /["']\/start["']/.test(combined) ||
    /ROUTES[\s\S]{0,400}\/start/.test(combined);
  const importsStart =
    /pages\/Start|pages\/StartGuide|pages\/FirstRun|from ["'].*Start["']/.test(combined);
  return pathWired || (importsStart && /start/i.test(combined));
}

function pageHasChecklist(src) {
  return (
    (/checklist|check-list|first-run|firstrun|getting.?started/i.test(src) &&
      (/step|steps|signed_in|starter_installed|candidates_promoted|connect_ready/i.test(src) ||
        /todo|done|blocked|status/i.test(src))) ||
    (/data-testid=["'][^"']*checklist/.test(src) && /step/i.test(src))
  );
}

function pageSupportsStarterInstallUi(src, clientSrc) {
  const pageMentionsInstall =
    /starter-?pack|installStarterPack|starterPacks|admin\/starter-packs/i.test(src) &&
    (/install/i.test(src) || /onClick|mutation|useMutation/i.test(src));
  const clientHasStarter =
    /starter-packs|installStarterPack|listStarterPacks|starterPacks/i.test(clientSrc);
  // UI path: page triggers install (not docs-only). Prefer page+client together.
  return pageMentionsInstall && (clientHasStarter || /fetch\(|api\.|client\./i.test(src));
}

function hasBatchPromotePath(pageSrc, clientSrc, serverCombined) {
  const uiBatch =
    /batch|promoteAll|promote-all|bulk.?promote|batchTransitions|batch-promote|batch-transitions/i.test(
      pageSrc,
    );
  const clientBatch =
    /batchTransitions|batchPromote|batch-transitions|batch-promote|lifecycle\/batch/i.test(
      clientSrc,
    );
  const serverBatch =
    /batch-transitions|batch-promote|batchTransitions|batchPromote/i.test(serverCombined) &&
    (/active|candidate|transition/i.test(serverCombined) || /promote/i.test(serverCombined));
  // Pass if Start UI uses batch OR dedicated batch API exists for the UI to call.
  return (uiBatch && (clientBatch || serverBatch)) || (clientBatch && serverBatch);
}

function readServerLifecycleAndAdmin() {
  const rels = [
    "packages/server/src/routes/lifecycle.ts",
    "packages/server/src/routes/admin.ts",
    "packages/server/src/routes/admin-starter-packs.ts",
  ];
  return rels
    .filter((rel) => existsSync(join(ROOT, rel)))
    .map((rel) => read(rel))
    .join("\n");
}

test("/start page source exists under packages/web/src/pages and is wired in the app router", () => {
  const page = findStartPageModule();
  assert.ok(
    page,
    "missing packages/web/src/pages/Start.tsx (or StartGuide/FirstRun) for route /start",
  );
  const routers = routerSources();
  assert.ok(routers.length > 0, "missing packages/web router sources (App.tsx or app/router.tsx)");
  assert.equal(
    startRouteWired(routers),
    true,
    "App.tsx / app/router.tsx / routes.ts must register /start (path start or ROUTES entry)",
  );
});

test("/start page exposes a checklist of first-run steps", () => {
  const page = findStartPageModule();
  assert.ok(page, "missing Start page module for checklist assertion");
  assert.equal(
    pageHasChecklist(page.src),
    true,
    `${page.rel} must render a first-run checklist with step statuses (e.g. signed_in, starter_installed, candidates_promoted, connect_ready)`,
  );
});

test("/start supports installing a starter pack from the UI (not only API docs)", () => {
  const page = findStartPageModule();
  assert.ok(page, "missing Start page module for starter-pack UI assertion");
  const clientPath = join(ROOT, "packages", "web", "src", "api", "client.ts");
  assert.ok(existsSync(clientPath), "missing packages/web/src/api/client.ts");
  const client = read("packages/web/src/api/client.ts");
  assert.equal(
    pageSupportsStarterInstallUi(page.src, client),
    true,
    `${page.rel} (and api/client.ts) must support starter-pack install from the UI via admin starter-packs API`,
  );
});

test("batch/promote path exists for candidate artifacts to active (UI or admin/lifecycle API used by UI)", () => {
  const page = findStartPageModule();
  assert.ok(page, "missing Start page module for batch promote assertion");
  const clientPath = join(ROOT, "packages", "web", "src", "api", "client.ts");
  assert.ok(existsSync(clientPath), "missing packages/web/src/api/client.ts");
  const client = read("packages/web/src/api/client.ts");
  const server = readServerLifecycleAndAdmin();
  assert.equal(
    hasBatchPromotePath(page.src, client, server),
    true,
    "must provide batch promote candidate→active on /start UI and/or a batch-transitions/batch-promote API wired for the UI",
  );
});
