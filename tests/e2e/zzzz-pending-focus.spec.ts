// E2E (fix-pending-focus): while a request runs, the control that started it keeps keyboard focus (aria-disabled, not
// disabled) and a second Enter sends nothing. The request is held with page.route and then let through to the stand.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;

/** Holds writes to `pattern` until release(); counts them. */
async function hold(page: Page, pattern: string) {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const state = { writes: 0 };
  await page.route(pattern, async (route) => {
    if (route.request().method() === "GET") return route.continue();
    state.writes++;
    await gate;
    await route.continue();
  });
  return { state, release: () => release() };
}

/** Enter on the focused button, a second Enter while pending, then the answer. */
async function pressWhilePending(page: Page, button: Locator, held: Awaited<ReturnType<typeof hold>>) {
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-disabled", "true");
  // Playwright's toBeDisabled also counts aria-disabled; the native attribute is what drops keyboard focus.
  await expect(button).not.toHaveAttribute("disabled", /.*/);
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  expect(held.state.writes).toBe(1);
  held.release();
  await expect(button).not.toHaveAttribute("aria-disabled", "true");
  expect(held.state.writes).toBe(1);
}

test.describe.serial("controls keep focus while a request runs", () => {
  test.afterEach(async ({ page }) => {
    await logout(page);
  });

  test("metadata: Save", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    const held = await hold(page, "**/api/v1/artifacts/skill/pdf-tools/metadata");
    await page.goto("/artifacts/skill/pdf-tools");
    await page.locator(tid("metadata-display-name")).fill("PDF tools (focus check)");
    const save = page.locator(tid("metadata-save"));
    await pressWhilePending(page, save, held);
    await expect(save).toBeFocused();
  });

  test("comments: Post; an empty comment keeps the button disabled", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    const held = await hold(page, "**/api/v1/artifacts/skill/pdf-tools/comments");
    await page.goto("/artifacts/skill/pdf-tools?tab=comments");
    const submit = page.locator(tid("comment-submit"));
    // Negative: unavailable by meaning (nothing to post) stays a real disabled button.
    await expect(submit).toHaveAttribute("disabled", /.*/);
    await page.locator(tid("comment-body")).fill("focus check");
    await pressWhilePending(page, submit, held);
  });

  test("tokens: Create", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "alice");
    const held = await hold(page, "**/api/v1/me/tokens");
    await page.goto("/me/tokens");
    await page.locator(tid("token-name")).fill("focus-check");
    await pressWhilePending(page, page.locator(tid("token-create-submit")), held);
  });
});
