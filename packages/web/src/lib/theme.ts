export type Theme = "light" | "dark" | "system";

const KEY = "skillforge.theme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* ignore */
  }
  return "system";
}

export function applyTheme(theme: Theme): void {
  const rootEl = document.documentElement;
  if (theme === "system") {
    rootEl.removeAttribute("data-theme");
  } else {
    rootEl.setAttribute("data-theme", theme);
  }
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

export function cycleTheme(): Theme {
  const cur = getTheme();
  const next: Theme = cur === "light" ? "dark" : cur === "dark" ? "system" : "light";
  setTheme(next);
  return next;
}

export function initTheme(): Theme {
  const t = getTheme();
  applyTheme(t);
  return t;
}
