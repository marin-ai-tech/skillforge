// Sign-in helpers for e2e: page.request shares the cookie jar with the page context,
// so signing in through the API immediately applies to navigation.
import type { Page } from "@playwright/test";

export const ADMIN_PASSWORD = "e2e-admin-pw";
export const USERS = {
  admin: { username: "admin", password: ADMIN_PASSWORD, role: "admin" },
  alice: { username: "alice", password: "alice-pw-1", role: "contributor" },
  bob: { username: "bob", password: "bob-pw-123", role: "viewer" },
  rita: { username: "rita", password: "rita-pw-123", role: "reviewer" },
} as const;

export async function loginAs(page: Page, who: keyof typeof USERS): Promise<void> {
  const u = USERS[who];
  const r = await page.request.post("/api/v1/auth/login", {
    data: { username: u.username, password: u.password },
  });
  if (r.status() !== 200) {
    throw new Error(`login ${u.username} failed: ${r.status()} ${await r.text()}`);
  }
}

export async function logout(page: Page): Promise<void> {
  await page.request.post("/api/v1/auth/logout");
}
