import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Moon, Sun, Monitor, Bell } from "lucide-react";
import { cycleTheme, initTheme, type Theme } from "../lib/theme.ts";
import { STR } from "../lib/strings.ts";
import { LANGS, nativeName, setLang, useLang, type Lang } from "../i18n/index.ts";
import { roleAtLeast, useMe } from "../lib/auth.tsx";
import { UserMenu } from "../components/UserMenu.tsx";
import { HelpPanel } from "../components/HelpPanel.tsx";
import { HelpTip } from "../components/HelpTip.tsx";
import { useHeightVar } from "../components/StickyBar.tsx";
import { ApiError, getPluginsUi, listNotifications } from "../api/client.ts";

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "dark") return <Moon className="h-4 w-4" aria-hidden />;
  if (theme === "light") return <Sun className="h-4 w-4" aria-hidden />;
  return <Monitor className="h-4 w-4" aria-hidden />;
}

/** Interface language choice; nothing to choose when only one dictionary is built in. */
function LangSwitch({ lang }: { lang: Lang }) {
  if (LANGS.length < 2) return null;
  return (
    <HelpTip action="lang-switch">
      <select
        data-testid="lang-switch"
        aria-label={STR.meta.langSwitch}
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        className="rounded-sf border border-line bg-bg px-2 py-1.5 text-sm text-ink-2"
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {nativeName(l)}
          </option>
        ))}
      </select>
    </HelpTip>
  );
}

export function Layout() {
  const navigate = useNavigate();
  const lang = useLang();
  const searchRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useHeightVar(headerRef, "--sf-header-h");
  const [theme, setThemeState] = useState<Theme>("system");
  const [q, setQ] = useState("");
  const meQuery = useMe();
  const user = meQuery.data ?? null;
  const pluginsUi = useQuery({
    queryKey: ["plugins-ui"],
    queryFn: getPluginsUi,
    staleTime: 60_000,
  });
  const [notifStopped, setNotifStopped] = useState(false);
  const unreadQ = useQuery({
    queryKey: ["notif-unread"],
    queryFn: async () => {
      try {
        return await listNotifications({ unread: true, limit: 1 });
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setNotifStopped(true);
        }
        throw e;
      }
    },
    enabled: !!user && !notifStopped,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (!user || notifStopped) return;
    const onFocus = () => {
      void unreadQ.refetch();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [user, notifStopped, unreadQ]);

  useEffect(() => {
    setThemeState(initTheme());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header ref={headerRef} className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/" className="text-base font-semibold text-ink no-underline">
            {STR.nav.brand}
          </Link>
          <Link to="/artifacts" className="text-sm text-ink-2 no-underline hover:text-accent">
            {STR.nav.catalog}
          </Link>
          <Link
            to="/metrics"
            data-testid="nav-metrics"
            className="text-sm text-ink-2 no-underline hover:text-accent"
          >
            {STR.nav.metrics}
          </Link>
          <Link
            to="/help"
            data-testid="nav-help"
            className="text-sm text-ink-2 no-underline hover:text-accent"
          >
            {STR.nav.help}
          </Link>
          {roleAtLeast(user?.role, "reviewer") ? (
            <Link
              to="/start"
              data-testid="nav-start"
              className="text-sm text-ink-2 no-underline hover:text-accent"
            >
              {STR.nav.start}
            </Link>
          ) : null}
          {(pluginsUi.data?.nav ?? []).map((item) => (
            <Link
              key={`${item.plugin}-${item.id}`}
              to={item.path}
              data-testid={`nav-ext-${item.plugin}-${item.id}`}
              translate="no"
              className="text-sm text-ink-2 no-underline hover:text-accent"
            >
              {item.label}
            </Link>
          ))}
          {user ? (
            <>
              <Link
                to="/teams"
                data-testid="nav-teams"
                className="text-sm text-ink-2 no-underline hover:text-accent"
              >
                {STR.nav.teams}
              </Link>
              <HelpTip action="nav-publish">
                <Link
                  to="/publish"
                  data-testid="nav-publish"
                  className="text-sm text-ink-2 no-underline hover:text-accent"
                >
                  {STR.nav.publish}
                </Link>
              </HelpTip>
            </>
          ) : null}
          <form
            className="ml-auto flex min-w-[200px] flex-1 max-w-md"
            onSubmit={(e) => {
              e.preventDefault();
              const value = q.trim();
              navigate(value ? `/artifacts?q=${encodeURIComponent(value)}` : "/artifacts");
            }}
          >
            <HelpTip action="nav-search">
              <input
                ref={searchRef}
                data-testid="nav-search"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={STR.nav.searchPlaceholder}
                className="w-full rounded-sf border border-line bg-bg px-3 py-1.5 text-sm text-ink placeholder:text-muted"
              />
            </HelpTip>
          </form>
          {user ? (
            <HelpTip action="nav-notifications">
              <Link
                to="/me/notifications"
                data-testid="nav-notifications"
                className="relative inline-flex items-center rounded-sf border border-line px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
                aria-label={STR.nav.notifications}
              >
                <Bell className="h-4 w-4" aria-hidden />
                {(unreadQ.data?.unread_count ?? 0) > 0 ? (
                  <span
                    data-testid="notif-count"
                    className="ml-1 rounded-sf bg-accent px-1.5 py-0.5 text-xs font-medium text-white"
                  >
                    {unreadQ.data!.unread_count}
                  </span>
                ) : null}
              </Link>
            </HelpTip>
          ) : null}
          {user ? (
            <UserMenu user={user} />
          ) : (
            <HelpTip action="nav-login">
              <Link
                to="/login"
                data-testid="nav-login"
                className="rounded-sf border border-line px-2 py-1.5 text-sm text-ink-2 no-underline hover:bg-surface-2"
              >
                {STR.nav.login}
              </Link>
            </HelpTip>
          )}
          <LangSwitch lang={lang} />
          <HelpTip action="theme-toggle">
            <button
              type="button"
              data-testid="theme-toggle"
              aria-label={STR.nav.theme}
              className="inline-flex items-center gap-1 rounded-sf border border-line px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-2"
              onClick={() => setThemeState(cycleTheme())}
            >
              <ThemeIcon theme={theme} />
              <span className="sr-only">{STR.nav.themeNames[theme]}</span>
            </button>
          </HelpTip>
        </div>
      </header>
      <main className="mx-auto max-w-[1200px] px-4 py-6">
        <Outlet />
      </main>
      <HelpPanel />
    </div>
  );
}
