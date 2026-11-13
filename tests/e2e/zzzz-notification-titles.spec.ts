// E2E (fix-readable-codes): a notification title is built from its kind in the reader's language; a plugin's own
// title stays as it is. The list is stubbed with page.route, so the spec needs no real status change.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const item = (over: Record<string, unknown>) => ({
  id: String(Math.random()),
  kind: "status_change",
  artifact: { type: "skill", name: "zip-beta" },
  version: "0.1.0",
  comment_id: null,
  actor: "rita",
  title: "status_change: skill/zip-beta",
  text: null,
  url: "/artifacts/skill/zip-beta",
  created_at: "2026-11-13T08:00:00.000Z",
  read: false,
  ...over,
});

test("status change: a readable title and kind label; a plugin keeps its own title", async ({ page }) => {
  await page.goto("/");
  await loginAs(page, "alice");
  await page.route("**/api/v1/me/notifications?**", (route) =>
    route.fulfill({
      json: {
        items: [item({}), item({ kind: "plugin", artifact: null, title: "Review finished: 2 findings", url: "/me/notifications" })],
        unread_count: 2,
        next_cursor: null,
      },
    }),
  );
  await page.route("**/api/v1/me/notifications", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { items: [item({}), item({ kind: "plugin", artifact: null, title: "Review finished: 2 findings", url: "/me/notifications" })], unread_count: 2, next_cursor: null } })
      : route.continue(),
  );
  await page.goto("/me/notifications");
  const rows = page.locator(tid("notification-row"));
  await expect(rows.first()).toContainText("Status changed: skill/zip-beta");
  await expect(rows.first()).toContainText("Status change");
  await expect(page.locator("main")).not.toContainText("status_change");
  // Negative: a plugin's title is its own text.
  await expect(rows.nth(1)).toContainText("Review finished: 2 findings");
  await logout(page);
});
