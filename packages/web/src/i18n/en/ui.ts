/** Interface strings: ui (shell and shared components, catalog, home, sign-in). */
export const ui = {
  /** `document.title` suffix after the page name. */
  titleSuffix: " · SkillForge",
  /** Type chip caption by type id (unknown types show the id). */
  typeOne: {
    skill: "skill",
    command: "command",
    agent: "agent",
    hook: "hook",
    plugin: "plugin",
    settings: "settings",
    "mcp-server": "MCP server",
  },
  /** Plural type caption by type id (unknown types show the server `plural`). */
  typePlural: {
    skill: "Skills",
    command: "Commands",
    agent: "Agents",
    hook: "Hooks",
    plugin: "Plugins",
    settings: "Settings profiles",
    "mcp-server": "MCP servers",
  },
  confirm: {
    confirm: "Confirm",
    cancel: "Cancel",
    learnMore: "Learn more",
  },
  empty: {
    title: "Nothing here",
  },
  duplicates: {
    empty: "No likely duplicates",
    score: (score: string) => `score ${score}`,
  },
  userMenu: {
    agents: "Agents",
    plugins: "Plugins",
    agentsAdmin: "Agents admin",
    assistant: "Assistant",
    audit: "Audit log",
    report: "Report",
    inventory: "Inventory",
    rollout: "Rollout",
    harvest: "Rules from reviews",
    packs: "Method packs",
  },
  home: {
    boardCounts: (aging: number, zombie: number) => `${aging} aging, ${zombie} zombie`,
    openDeleteBoard: "Open delete board",
  },
  browse: {
    team: "Team",
    owner: "Owner",
    label: "Label",
    allTeams: "All teams",
    allOwners: "All owners",
    allLabels: "All labels",
    agent: "Agent",
    allAgents: "All agents",
  },
  login: {
    method: "Sign-in method",
  },
  notFound: {
    artifactBefore: 'Artifact "',
    artifactAfter: '" was not found.',
  },
  ext: {
    pageTitle: "Plugin page",
    missing: "This plugin page was not found.",
    failed: "Failed to load plugin page.",
  },
};

export type Ui = typeof ui;
