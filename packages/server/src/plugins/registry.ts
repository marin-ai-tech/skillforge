import type { PluginManifest } from "./manifest.ts";

export type PluginStatus = "loaded" | "error" | "disabled";

export type PluginContributions = {
  routes: number;
  nav: number;
  tabs: number;
  events: string[];
  routeFns: Array<(app: unknown) => unknown | Promise<unknown>>;
  publicPaths: string[];
  navItems: Array<{ id: string; label: string; page: string }>;
  pages: Map<
    string,
    () => { title: string; markdown: string } | Promise<{ title: string; markdown: string }>
  >;
  tabsHandlers: Map<
    string,
    {
      id: string;
      label: string;
      handler: (args: {
        artifact: unknown;
        version: unknown;
        user: unknown;
      }) => { markdown: string } | Promise<{ markdown: string }>;
    }
  >;
};

export type PluginState = {
  name: string;
  dir: string;
  manifest: PluginManifest | null;
  status: PluginStatus;
  error: string | null;
  enabled: boolean;
  contributions: PluginContributions;
  restartRequired: boolean;
  configSchema: PluginManifest["config_schema"];
};

export function emptyContributions(): PluginContributions {
  return {
    routes: 0,
    nav: 0,
    tabs: 0,
    events: [],
    routeFns: [],
    publicPaths: [],
    navItems: [],
    pages: new Map(),
    tabsHandlers: new Map(),
  };
}

export class PluginRegistry {
  private states = new Map<string, PluginState>();
  disabled = false;
  dir = "";

  reset(): void {
    this.states.clear();
    this.disabled = false;
    this.dir = "";
  }

  set(state: PluginState): void {
    this.states.set(state.name, state);
  }

  get(name: string): PluginState | undefined {
    return this.states.get(name);
  }

  list(): PluginState[] {
    return [...this.states.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  health(): { loaded: number; errors: number; disabled: number } {
    let loaded = 0;
    let errors = 0;
    let disabled = 0;
    for (const s of this.states.values()) {
      if (s.status === "loaded") loaded += 1;
      else if (s.status === "error") errors += 1;
      else if (s.status === "disabled") disabled += 1;
    }
    return { loaded, errors, disabled };
  }
}

/** Process-wide registry (one per running server). */
export const pluginRegistry = new PluginRegistry();
