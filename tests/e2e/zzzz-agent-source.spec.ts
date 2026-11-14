// fix-agent-source-ui: a file built from a registry artifact (front matter `skillforge-source`) on the agent page — the
// mark links to its source, the local name is not a link to a page that does not exist, and neither publishing nor an
// install command is offered for it. Negative case: a plain local_only row keeps its publish button.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const built = (marker: string, role: string) =>
  `---\ndescription: The ${role} role of this project.\nmode: subagent\nskillforge-source: ${marker}\n---\n\nYou are the ${role}.\n`;
const plain = `---\ndescription: A local helper agent of this project.\nmode: subagent\n---\n\nYou help locally.\n`;

test("a built file links to its source and offers no publish or install", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "alice");
  const art = await page.request.get("/api/v1/artifacts/agent/handoff-executor");
  expect(art.status()).toBe(200);
  const latest = ((await art.json()) as { artifact?: { latest_version?: string }; latest_version?: string });
  const version = latest.artifact?.latest_version ?? latest.latest_version;
  expect(version).toBeTruthy();
  const put = await page.request.put("/api/v1/me/agents/built-roles", {
    data: {
      runtime: "opencode",
      files: [
        { path: "agents/sdlc-executor.md", content_base64: b64(built(`agent/handoff-executor@${version}`, "executor")) },
        { path: "agents/sdlc-gone.md", content_base64: b64(built("agent/handoff-executor@0.0.1", "gone")) },
        { path: "agents/local-helper.md", content_base64: b64(plain) },
      ],
    },
  });
  expect(put.status(), await put.text()).toBeLessThan(300);

  await page.goto("/me/agents/built-roles");
  const current = page.locator(`${tid("agent-item")}[data-key="agent/sdlc-executor"]`);
  await expect(current).toHaveAttribute("data-status", "in_sync");
  const mark = current.locator(tid("agent-item-source"));
  await expect(mark).toContainText(`agent/handoff-executor@${version}`);
  await expect(mark.locator("a")).toHaveAttribute("href", "/artifacts/agent/handoff-executor");
  await expect(current.locator("td").first().locator("a")).toHaveCount(0);

  const gone = page.locator(`${tid("agent-item")}[data-key="agent/sdlc-gone"]`);
  await expect(gone).toHaveAttribute("data-status", "modified");
  await expect(gone.locator(tid("agent-item-source"))).toContainText("agent/handoff-executor@0.0.1");
  await expect(gone.locator(tid("agent-item-publish"))).toHaveCount(0);
  await expect(gone.locator(tid("agent-item-install"))).toHaveCount(0);

  const local = page.locator(`${tid("agent-item")}[data-key="agent/local-helper"]`);
  await expect(local).toHaveAttribute("data-status", "local_only");
  await expect(local.locator(tid("agent-item-source"))).toHaveCount(0);
  await expect(local.locator(tid("agent-item-publish"))).toHaveCount(1);
  await logout(page);
});
