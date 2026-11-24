// my-space-usage: «My space» lists the user's own usage reports with a link to each artifact; without reports it says
// how an agent reports (record_usage); a user with tokens but no agent snapshot and no session facts gets a first-steps
// hint. Each run creates its own user, so --repeat-each works.
import { test, expect, type Page } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

async function newUser(page: Page, info: { repeatEachIndex: number }): Promise<string> {
  const username = `usage-${info.repeatEachIndex}-${Date.now() % 1_000_000}`;
  await loginAs(page, "admin");
  const r = await page.request.post("/api/v1/admin/users", { data: { username, password: `${username}-pw`, role: "contributor" } });
  expect(r.status(), await r.text()).toBe(201);
  await logout(page);
  const l = await page.request.post("/api/v1/auth/login", { data: { username, password: `${username}-pw` } });
  expect(l.status(), await l.text()).toBe(200);
  return username;
}

test.describe("usage reports in My space", () => {
  test("a report shows as a row with a link to the card", async ({ page }, info) => {
    await page.goto("/");
    await newUser(page, info);
    const r = await page.request.post("/api/v1/artifacts/skill/pdf-tools/usage", { data: { uses: 7, helped: 5, basis: "loaded" } });
    expect([200, 201], await r.text()).toContain(r.status());
    await page.goto("/me");
    const section = page.locator(tid("me-usage"));
    await expect(section).toBeVisible();
    await expect(section.getByRole("heading")).toBeVisible();
    const row = section.locator(`${tid("me-usage-row")}[data-name="skill/pdf-tools"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("5");
    await expect(row).toContainText("7");
    await expect(row.getByRole("link", { name: /pdf-tools/ })).toHaveAttribute("href", /\/artifacts\/skill\/pdf-tools$/);
    await expect(section.locator(tid("me-usage-empty"))).toHaveCount(0);
  });

  test("empty: how to report, and a first-steps hint for tokens without data; the hint goes after a snapshot", async ({ page }, info) => {
    await page.goto("/");
    await newUser(page, info);
    const tok = await page.request.post("/api/v1/me/tokens", { data: { name: "first-token" } });
    expect(tok.status(), await tok.text()).toBe(201);
    await page.goto("/me");
    await expect(page.locator(tid("me-usage-empty"))).toContainText("record_usage");
    await expect(page.locator(tid("me-usage-empty"))).toContainText("skillforge report-usage");
    await expect(page.locator(tid("me-setup-hint"))).toContainText("skillforge agent scan");

    const md = "---\nname: local-only\ndescription: A local skill in the snapshot. Use when testing the hint.\n---\n\n# Local\n";
    const put = await page.request.put("/api/v1/me/agents/laptop", {
      data: { files: [{ path: "skills/local-only/SKILL.md", content_base64: Buffer.from(md).toString("base64") }] },
    });
    expect(put.status(), await put.text()).toBe(200);
    await page.reload();
    await expect(page.locator(tid("me-usage-empty"))).toBeVisible();
    await expect(page.locator(tid("me-setup-hint"))).toHaveCount(0);
  });

  test("negative: no first-steps hint without tokens", async ({ page }, info) => {
    await page.goto("/");
    await newUser(page, info);
    await page.goto("/me");
    await expect(page.locator(tid("me-usage-empty"))).toBeVisible();
    await expect(page.locator(tid("me-setup-hint"))).toHaveCount(0);
  });
});
