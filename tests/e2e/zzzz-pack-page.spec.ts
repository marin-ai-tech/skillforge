// pack-authoring: a method pack has its own page — header, roles of a chosen version, versions with who published them,
// a role and item diff between two versions — and its owner publishes a new version from a form that checks the
// items first. /packs links to the page and its role disclosure has aria-expanded. Each run uses its own names.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

async function skill(page: Page, name: string, version: string, activate = true): Promise<void> {
  const md = `---\nname: ${name}\ndescription: Pack page probe ${name}. Use when testing the pack page.\n---\n\n# ${name}\n\n${version}\n`;
  const r = await page.request.post("/api/v1/artifacts", {
    data: { type: "skill", version, files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }] },
  });
  expect(r.status(), await r.text()).toBe(201);
  if (activate) {
    const t = await page.request.post(`/api/v1/artifacts/skill/${name}/transitions`, { data: { to: "active", reason: "pack e2e" } });
    expect(t.status(), await t.text()).toBe(200);
  }
}

type Names = { pack: string; plan: string; build: string; review: string; draft: string };

async function setUp(page: Page, info: { repeatEachIndex: number }): Promise<Names> {
  const k = `${info.repeatEachIndex}-${Date.now() % 100000}`;
  const n: Names = { pack: `pk-${k}`, plan: `pk-plan-${k}`, build: `pk-build-${k}`, review: `pk-review-${k}`, draft: `pk-draft-${k}` };
  await page.goto("/");
  await loginAs(page, "admin");
  await skill(page, n.plan, "0.1.0");
  await skill(page, n.plan, "0.2.0", false);
  await skill(page, n.build, "0.1.0");
  await skill(page, n.review, "0.1.0");
  await skill(page, n.draft, "0.1.0", false);
  await logout(page);
  await loginAs(page, "alice");
  const item = (name: string, version = "0.1.0") => ({ type: "skill", name, version });
  for (const [version, roles] of [
    ["1.0.0", [{ name: "developer", description: "Builds", items: [item(n.plan), item(n.build)] }]],
    ["1.1.0", [
      { name: "developer", description: "Builds", items: [item(n.plan, "0.2.0")] },
      { name: "qa", description: "Checks", items: [item(n.review)] },
    ]],
  ] as const) {
    const r = await page.request.post("/api/v1/packs", { data: { name: n.pack, version, title: `Method ${k}`, description: "Our method.", roles } });
    expect(r.status(), await r.text()).toBe(201);
  }
  return n;
}

test.describe("method pack page", () => {
  test("header, roles, versions with authors, and the diff between two versions", async ({ page }, info) => {
    const n = await setUp(page, info);
    await page.goto(`/packs/${n.pack}`);
    await expect(page.locator(tid("pack-header"))).toContainText(n.pack);
    await expect(page.locator(tid("pack-header"))).toContainText("alice");
    await expect(page.locator(tid("pack-header"))).toContainText("1.1.0");
    await expect(page.locator(tid("pack-roles"))).toContainText("qa");
    const versions = page.locator(tid("pack-versions"));
    await expect(versions.getByRole("columnheader")).toHaveCount(3);
    await expect(versions).toContainText("1.0.0");
    await expect(versions).toContainText("1.1.0");
    await expect(versions).toContainText("alice");
    const diff = page.locator(tid("pack-compare"));
    await expect(diff).toContainText(`${n.plan}`);
    await expect(diff).toContainText("0.1.0 → 0.2.0");
    await expect(diff).toContainText(n.build);
    await expect(diff).toContainText("qa");

    await page.locator(tid("pack-version-select")).selectOption("1.0.0");
    await expect(page).toHaveURL(/version=1\.0\.0/);
    await expect(page.locator(tid("pack-roles"))).not.toContainText("qa");
  });

  test("new version form: a problem blocks publishing, the fix publishes", async ({ page }, info) => {
    const n = await setUp(page, info);
    await page.goto(`/packs/${n.pack}`);
    await page.locator(tid("pack-new-version")).click();
    const form = page.locator(tid("pack-form"));
    await expect(form).toBeVisible();
    const items = form.getByLabel(/items/i).first();
    await expect(items).toHaveValue(new RegExp(`skill/${n.plan}@0\\.2\\.0`));
    await items.fill(`skill/${n.plan}@0.2.0\nskill/${n.draft}@0.1.0`);
    const publish = form.locator(tid("pack-publish"));
    await expect(publish).toBeDisabled();
    await form.locator(tid("pack-check")).click();
    const problems = form.locator(tid("pack-problems"));
    await expect(problems).toHaveAttribute("role", "alert");
    await expect(problems).toContainText(n.draft);
    await expect(publish).toBeDisabled();

    await items.fill(`skill/${n.plan}@0.2.0`);
    await expect(publish).toBeDisabled();
    await form.locator(tid("pack-check")).click();
    await expect(form.locator(tid("pack-problems"))).toHaveCount(0);
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page.getByRole("status")).toContainText(`${n.pack}@1.1.1`);
    await expect(page.locator(tid("pack-header"))).toContainText("1.1.1");
  });

  test("/packs: the name links to the page, roles open with aria-expanded", async ({ page }, info) => {
    const n = await setUp(page, info);
    await page.goto("/packs");
    const row = page.locator(tid("pack")).filter({ hasText: n.pack });
    await expect(row.getByRole("link", { name: new RegExp(n.pack) })).toHaveAttribute("href", new RegExp(`/packs/${n.pack}$`));
    const open = row.locator(tid("pack-open"));
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(row.locator(tid("pack-role")).first()).toBeVisible();
  });

  test("negative: a viewer has no new-version button; an unknown pack says so", async ({ page }, info) => {
    const n = await setUp(page, info);
    await logout(page);
    await loginAs(page, "bob");
    await page.goto(`/packs/${n.pack}`);
    await expect(page.locator(tid("pack-header"))).toBeVisible();
    await expect(page.locator(tid("pack-new-version"))).toHaveCount(0);
    await page.goto("/packs/no-such-pack-anywhere");
    await expect(page.locator(tid("pack-not-found"))).toBeVisible();
    await expect(page.locator(tid("pack-not-found")).getByRole("link")).toHaveAttribute("href", /\/packs$/);
  });
});
