// E2E: comment → bell and notifications page; editing and deleting one's own
// comment; filter by version. Seeds: alice (contributor), bob (viewer), pdf-tools (admin).
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

test.describe("comments and notifications", () => {
  test("a mention reaches the addressee; edit → (edited); delete → [deleted]", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    await page.goto("/artifacts/skill/pdf-tools?tab=comments");
    await expect(page.locator(tid("comments-tab"))).toBeVisible();

    // Post a comment mentioning bob.
    await page.locator(tid("comment-body")).fill("@bob e2e ping from alice");
    await page.locator(tid("comment-submit")).click();
    const row = page.locator(tid("comment-row")).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText("@bob e2e ping from alice");
    const commentId = await row.getAttribute("data-comment-id");
    expect(commentId).toBeTruthy();

    // Version filter: another version hides the comment, "all" brings it back.
    const rowVersion = (await row.locator("span.font-mono").first().textContent())?.replace("v", "");
    const other = rowVersion === "0.2.0" ? "0.1.0" : "0.2.0";
    await page.locator(tid("comments-version-filter")).selectOption(other);
    await expect(page.locator(tid("comment-row"))).toHaveCount(0);
    await page.locator(tid("comments-version-filter")).selectOption("");
    await expect(row).toBeVisible();

    // Editing one's own comment → the (edited) mark.
    await row.locator(tid(`comment-edit-${commentId}`)).click();
    await row.locator("textarea").fill("@bob e2e ping from alice (updated)");
    await row.getByRole("button", { name: "Save" }).click();
    await expect(row).toContainText("(edited)");
    await expect(row).toContainText("(updated)");

    // bob: the bell and a notification row linking to the artifact.
    await logout(page);
    await loginAs(page, "bob");
    await page.goto("/");
    await expect(page.locator(tid("notif-count"))).toBeVisible();
    await page.goto("/me/notifications");
    const nRow = page.locator(tid("notification-row")).filter({ hasText: "pdf-tools" }).first();
    await expect(nRow).toBeVisible();

    // Deleting one's own comment → [deleted].
    await logout(page);
    await loginAs(page, "alice");
    await page.goto("/artifacts/skill/pdf-tools?tab=comments");
    const row2 = page.locator(tid("comment-row")).first();
    await row2.locator(tid(`comment-delete-${commentId}`)).click();
    await page.locator(tid("confirm-dialog")).locator(tid("dialog-confirm")).click();
    await expect(row2).toContainText("[deleted]");
    await logout(page);
  });

  test("an anonymous user does not see the comment form", async ({ page }) => {
    await page.goto("/artifacts/skill/pdf-tools?tab=comments");
    await expect(page.locator(tid("comments-tab"))).toBeVisible();
    await expect(page.locator(tid("comment-body"))).toHaveCount(0);
  });
});
