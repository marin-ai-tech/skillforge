// Team visibility of an artifact: a team member sees the card and the scope marker,
// an outsider gets NotFound. The team and the artifact are created inside the spec.
import { test, expect } from "@playwright/test";
import { loginAs, logout } from "./auth-helpers.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

test.describe("visibility of a team artifact", () => {
  test("a member sees the card, an outsider gets NotFound", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, "admin");

    // Team e2e-gamma with alice as lead (a member).
    const team = await page.request.post("/api/v1/teams", {
      data: {
        name: "e2e-gamma",
        display_name: "E2E Gamma",
        lead: "alice",
        description: "Visibility e2e team",
      },
    });
    expect([200, 201, 409]).toContain(team.status());

    // An artifact owned by the team (alice is the owner-member).
    const pub = await page.request.post("/api/v1/artifacts", {
      data: {
        type: "skill",
        visibility: "team",
        owner_team: "e2e-gamma",
        files: [
          {
            path: "SKILL.md",
            content_base64: b64(
              `---\nname: e2e-gamma-skill\ndescription: Team-scoped artifact for visibility e2e.\n---\n\n# e2e-gamma-skill\n`,
            ),
          },
        ],
      },
    });
    expect([200, 201, 409]).toContain(pub.status());
    await logout(page);

    // A team member sees the artifact and the scope marker.
    await loginAs(page, "alice");
    await page.goto("/artifacts/skill/e2e-gamma-skill");
    await expect(page.locator(tid("detail-name"))).toBeVisible();
    await expect(page.locator(tid("artifact-visibility"))).toContainText("team");
    await logout(page);

    // An outsider gets NotFound (and the API responds 404).
    await loginAs(page, "bob");
    const api = await page.request.get("/api/v1/artifacts/skill/e2e-gamma-skill");
    expect(api.status()).toBe(404);
    await page.goto("/artifacts/skill/e2e-gamma-skill");
    await expect(page.locator(tid("not-found"))).toBeVisible();
    await expect(page.locator(tid("detail-name"))).toHaveCount(0);
    await logout(page);
  });
});
