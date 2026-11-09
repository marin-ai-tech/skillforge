import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { logout, type MeUser } from "../api/client.ts";
import { roleAtLeast } from "../lib/auth.tsx";
import { STR } from "../lib/strings.ts";
import { HelpTip } from "./HelpTip.tsx";

type Props = { user: MeUser };

export function UserMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const localMode = user.username === "local";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  async function onLogout() {
    setOpen(false);
    try {
      await logout();
    } catch {
      /* ignore */
    }
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    navigate("/");
  }

  const logoutBtn = (inMenu: boolean) => (
    <HelpTip action="nav-logout">
      <button
        type="button"
        data-testid="nav-logout"
        role={inMenu ? "menuitem" : undefined}
        className={
          inMenu
            ? "block w-full px-3 py-1.5 text-left text-sm text-ink-2 hover:bg-surface-2"
            : "rounded-sf border border-line px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
        }
        onClick={() => void onLogout()}
      >
        {STR.nav.logout}
      </button>
    </HelpTip>
  );

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      <HelpTip action="nav-user">
        <button
          type="button"
          data-testid="nav-user"
          translate="no"
          aria-haspopup="menu"
          aria-expanded={open}
          className="rounded-sf border border-line px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
          onClick={() => setOpen((v) => !v)}
        >
          {user.username}
        </button>
      </HelpTip>
      {localMode ? (
        <span
          data-testid="local-mode"
          className="rounded-sf bg-surface-2 px-1.5 py-0.5 text-xs text-muted"
        >
          {STR.login.localMode}
        </span>
      ) : null}
      {!open && !localMode ? logoutBtn(false) : null}
      {open ? (
        <div
          data-testid="user-menu"
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 min-w-[10rem] rounded-sf border border-line bg-surface py-1 shadow-sm"
        >
          <HelpTip action="menu-me">
            <Link
              to="/me"
              data-testid="menu-me"
              role="menuitem"
              className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
              onClick={() => setOpen(false)}
            >
              {STR.nav.menuMe}
            </Link>
          </HelpTip>
          <HelpTip action="menu-tokens">
            <Link
              to="/me/tokens"
              data-testid="menu-tokens"
              role="menuitem"
              className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
              onClick={() => setOpen(false)}
            >
              {STR.nav.menuTokens}
            </Link>
          </HelpTip>
          {!localMode ? (
            <HelpTip action="menu-password">
              <Link
                to="/me/password"
                data-testid="menu-password"
                role="menuitem"
                className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                {STR.nav.menuPassword}
              </Link>
            </HelpTip>
          ) : null}
          <HelpTip action="menu-agents">
            <Link
              to="/me/agents"
              data-testid="menu-agents"
              role="menuitem"
              className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
              onClick={() => setOpen(false)}
            >
              {STR.ui.userMenu.agents}
            </Link>
          </HelpTip>
          <HelpTip action="menu-packs">
            <Link
              to="/packs"
              data-testid="menu-packs"
              role="menuitem"
              className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
              onClick={() => setOpen(false)}
            >
              {STR.ui.userMenu.packs}
            </Link>
          </HelpTip>
          {roleAtLeast(user.role, "contributor") ? (
            <HelpTip action="menu-import">
              <Link
                to="/import"
                data-testid="menu-import"
                role="menuitem"
                className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                {STR.nav.menuImport}
              </Link>
            </HelpTip>
          ) : null}
          {roleAtLeast(user.role, "reviewer") ? (
            <HelpTip action="menu-lifecycle">
              <Link
                to="/lifecycle"
                data-testid="menu-lifecycle"
                role="menuitem"
                className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                onClick={() => setOpen(false)}
              >
                {STR.nav.menuLifecycle}
              </Link>
            </HelpTip>
          ) : null}
          {user.role === "admin" ? (
            <>
              <HelpTip action="menu-admin">
                <Link
                  to="/admin/users"
                  data-testid="menu-admin"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.nav.menuAdmin}
                </Link>
              </HelpTip>
              <HelpTip action="menu-backups">
                <Link
                  to="/admin/backups"
                  data-testid="menu-backups"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.nav.menuBackups}
                </Link>
              </HelpTip>
              <HelpTip action="menu-plugins">
                <Link
                  to="/admin/plugins"
                  data-testid="menu-plugins"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.plugins}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-agents">
                <Link
                  to="/admin/agents"
                  data-testid="menu-admin-agents"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.agentsAdmin}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-lifecycle">
                <Link
                  to="/admin/lifecycle"
                  data-testid="menu-admin-lifecycle"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.nav.menuAdminLifecycle}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-assistant">
                <Link
                  to="/admin/assistant"
                  data-testid="menu-admin-assistant"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.assistant}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-audit">
                <Link
                  to="/admin/audit"
                  data-testid="menu-admin-audit"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.audit}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-report">
                <Link
                  to="/admin/report"
                  data-testid="menu-admin-report"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.report}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-inventory">
                <Link
                  to="/admin/inventory"
                  data-testid="menu-admin-inventory"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.inventory}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-rollout">
                <Link
                  to="/admin/rollout"
                  data-testid="menu-admin-rollout"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.rollout}
                </Link>
              </HelpTip>
              <HelpTip action="menu-admin-harvest">
                <Link
                  to="/admin/harvest"
                  data-testid="menu-admin-harvest"
                  role="menuitem"
                  className="block px-3 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
                  onClick={() => setOpen(false)}
                >
                  {STR.ui.userMenu.harvest}
                </Link>
              </HelpTip>
            </>
          ) : null}
          {!localMode ? logoutBtn(true) : null}
        </div>
      ) : null}
    </div>
  );
}
