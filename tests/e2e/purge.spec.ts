// Acceptance e2e for the purge dialog on a disposable artifact: a version, then the whole artifact;
// a viewer does not see the trigger. The artifact is published inside the spec, so seeds are untouched.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function publishDoomed(page: import("@playwright/test").Page, version: string) {
  const r = await page.request.post("/api/v1/artifacts", {
    data: {
      type: "skill",
      version,
      files: [
        {
          path: "SKILL.md",
          content_base64: b64(
            `---\nname: e2e-purge-target\ndescription: Throwaway artifact for purge e2e (v${version}).\n---\n\n# e2e-purge-target\n`,
          ),
        },
      ],
    },
  });
  expect([200, 201, 409]).toContain(r.status());
}

test.describe("purge dialog", () => {
  test("admin: purge of a version and of an artifact with confirmation; viewer without the button", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");
    await publishDoomed(page, "0.1.0");
    await publishDoomed(page, "0.2.0");

    // Purge of a version: the dialog requires reason ≥10 and an exact confirm.
    await page.goto("/artifacts/skill/e2e-purge-target?tab=versions");
    await page.locator(tid("purge-version-0.1.0")).click();
    const dialog = page.getByRole("dialog", { name: "Purge skill/e2e-purge-target@0.1.0" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(tid("purge-submit"))).toBeDisabled();
    await dialog.locator(tid("purge-reason")).fill("leaked test token cleanup");
    await dialog.locator(tid("purge-confirm-input")).fill("wrong-confirm");
    await expect(dialog.locator(tid("purge-submit"))).toBeDisabled();
    await dialog.locator(tid("purge-confirm-input")).fill("skill/e2e-purge-target@0.1.0");
    await expect(dialog.locator(tid("purge-submit"))).toBeEnabled();
    await dialog.locator(tid("purge-submit")).click();
    await expect(dialog).toContainText("Purged.");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(tid("version-purged-0.1.0"))).toBeVisible();

    // Purge of the whole artifact.
    await page.locator(tid("purge-artifact")).click();
    const dialog2 = page.getByRole("dialog", { name: "Purge skill/e2e-purge-target" });
    await dialog2.locator(tid("purge-reason")).fill("remove throwaway e2e artifact");
    await dialog2.locator(tid("purge-confirm-input")).fill("skill/e2e-purge-target");
    await dialog2.locator(tid("purge-submit")).click();
    await expect(dialog2).toContainText("Purged.");
    await dialog2.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(tid("artifact-purged"))).toBeVisible();
    await logout(page);

    // viewer: no purge trigger (the panel renders only for admin).
    await loginAs(page, "bob");
    await page.goto("/artifacts/skill/pdf-tools");
    await expect(page.locator(tid("detail-name"))).toBeVisible();
    await expect(page.locator(tid("purge-artifact"))).toHaveCount(0);
    await logout(page);
  });
});
