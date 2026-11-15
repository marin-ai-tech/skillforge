// E2E (metrics-by-runtime): the metrics tab shows a "By agent" table built from session facts. A known agent gets its
// name; any other source is "Other sources" and its raw string is not shown; a row of one user hides the pass rate when
// the artifact has more users. An artifact without facts has no table, and a narrow screen scrolls the table, not the page.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const NAME = "e2e-by-runtime";
const EMPTY = "e2e-by-runtime-empty";
let n = 0;
const fact = (verification: string) => ({
  skill: NAME,
  session_key: (0xbe000 + ++n).toString(16).padStart(32, "0"),
  used_at: new Date(Date.now() - n * 60_000).toISOString(),
  verification,
});

async function publish(page: Page, name: string) {
  const md = `---\nname: ${name}\ndescription: Skill for the by-agent table e2e check on the metrics tab.\n---\n\n# ${name}\n\nDo the task.\n`;
  const r = await page.request.post("/api/v1/artifacts", {
    data: { type: "skill", files: [{ path: `${name}/SKILL.md`, content_base64: Buffer.from(md).toString("base64") }] },
  });
  expect(r.status(), await r.text()).toBe(201);
}

async function send(page: Page, source: string, verification: string) {
  const r = await page.request.post("/api/v1/me/session-facts", { data: { source, facts: [fact(verification)] } });
  expect((await r.json()).accepted, source).toBe(1);
}

test("the By agent table: agent names, hidden pass rate of one user, other sources, no raw source", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "alice");
  await publish(page, NAME);
  await publish(page, EMPTY);
  await send(page, "claude-code", "pass");
  await send(page, "opencode", "fail");
  await send(page, "e2e", "pass");
  await logout(page);
  await loginAs(page, "rita");
  await send(page, "claude-code", "pass");

  await page.goto(`/artifacts/skill/${NAME}?tab=metrics`);
  const table = page.getByRole("table", { name: "By agent" });
  await expect(table).toBeVisible();
  await expect(page.locator(tid("metrics-by-runtime"))).toBeVisible();
  const claude = table.locator('[data-runtime="claude-code"]');
  await expect(claude).toContainText("Claude Code");
  await expect(claude).toContainText("100%");
  await expect(claude.locator("td").nth(0)).toHaveText("2");
  await expect(claude.locator("td").nth(1)).toHaveText("2");
  const opencode = table.locator('[data-runtime="opencode"]');
  await expect(opencode).toContainText("OpenCode");
  await expect(opencode).toContainText("Hidden: one user");
  const other = table.locator('[data-runtime=""]');
  await expect(other).toContainText("Other sources");
  await expect(other).toContainText("Hidden: one user");
  await expect(table).not.toContainText("e2e");
  await expect(table.locator("tbody tr").last()).toHaveAttribute("data-runtime", "");

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(table).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(`/artifacts/skill/${EMPTY}?tab=metrics`);
  await expect(page.locator(tid("metrics-sessions"))).toHaveText("0");
  await expect(page.locator(tid("metrics-by-runtime"))).toHaveCount(0);
  await logout(page);
});
