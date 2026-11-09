import {
  BarChart3,
  CircleX,
  ClipboardCheck,
  Gauge,
  LayoutDashboard,
  Library,
  MousePointerClick,
  Package,
  RefreshCw,
  Rocket,
  Server,
  Shield,
  ShieldAlert,
  TriangleAlert,
  UserRound,
  Users,
  Workflow,
  Compass,
  type LucideIcon,
} from "lucide-react";
import { listTopics, type HelpTopic } from "./index.ts";

/** A collapsible group inside a reference section (UI page group, action screen, code kind). */
export type HelpNavGroup = { id: string; topics: HelpTopic[] };

/** A top-level navigation section: guides list topics directly, reference sections hold groups. */
export type HelpNavSection = {
  id: string;
  icon: LucideIcon;
  topics: HelpTopic[];
  groups: HelpNavGroup[];
};

const GUIDES: Array<[string, LucideIcon]> = [
  ["start", Rocket],
  ["publishing", Package],
  ["lifecycle", RefreshCw],
  ["evidence", BarChart3],
  ["access", Users],
  ["automation", Workflow],
  ["operations", Server],
];

export const UI_GROUPS = ["ui-catalog", "ui-workspace", "ui-review", "ui-admin", "ui-other"];

/** Reader order inside guide sections; topics not listed follow alphabetically. */
const GUIDE_ORDER = [
  "getting-started/overview",
  "getting-started/roles",
  "getting-started/artifact-types",
  "getting-started/agent-support",
  "getting-started/install",
  "getting-started/cli",
  "getting-started/mcp",
  "getting-started/starter-packs",
  "shortcuts/keyboard",
  "getting-started/upload-artifacts",
  "getting-started/versions-and-digests",
  "getting-started/channels-and-pinning",
  "getting-started/metadata",
  "getting-started/labels",
  "getting-started/provenance",
  "getting-started/duplicates",
  "getting-started/quality",
  "getting-started/hook-risks",
  "getting-started/lifecycle",
  "getting-started/lifecycle-by-data",
  "getting-started/lifecycle-hold-sweep",
  "getting-started/review-assistant",
  "getting-started/comments-and-threads",
  "getting-started/notifications-and-watch",
  "getting-started/evidence-and-usage",
  "getting-started/skill-evals",
  "getting-started/eval-gate",
  "getting-started/eval-orchestrator",
  "getting-started/eval-runs-runners",
  "getting-started/ablation-report",
  "getting-started/reading-metrics",
  "getting-started/session-metrics",
  "getting-started/overhang",
  "getting-started/run-outputs",
  "getting-started/teams",
  "getting-started/visibility",
  "getting-started/ownership",
  "getting-started/sso",
  "getting-started/agents",
  "getting-started/workflows",
  "getting-started/routines",
  "getting-started/hooks-runtime",
  "getting-started/plugins",
  "getting-started/notifications-for-plugins",
  "getting-started/self-hosting",
  "getting-started/purge",
];

const CODE_GROUPS: Array<[string, string]> = [
  ["codes-errors", "E_"],
  ["codes-warnings", "W_"],
  ["codes-quality", "Q_"],
];

function guideRank(id: string): number {
  const i = GUIDE_ORDER.indexOf(id);
  return i === -1 ? GUIDE_ORDER.length : i;
}

const byGuideOrder = (a: HelpTopic, b: HelpTopic) =>
  guideRank(a.id) - guideRank(b.id) || a.title.localeCompare(b.title);
const byTitle = (a: HelpTopic, b: HelpTopic) => a.title.localeCompare(b.title);

/** `actions/<screen>/<topic>` → `actions-<screen>`. */
function actionGroupOf(id: string): string {
  return `actions-${id.split("/")[1] ?? "other"}`;
}

function codeGroupOf(id: string): string {
  const code = id.split("/")[1] ?? "";
  return CODE_GROUPS.find(([, prefix]) => code.startsWith(prefix))?.[0] ?? "codes-errors";
}

function groupBy(
  topics: HelpTopic[],
  key: (t: HelpTopic) => string,
  order: string[],
): HelpNavGroup[] {
  const ids = [...new Set([...order, ...topics.map(key).sort()])];
  return ids
    .map((id) => ({ id, topics: topics.filter((t) => key(t) === id).sort(byTitle) }))
    .filter((g) => g.topics.length > 0);
}

/** The navigation tree: seven guide sections, then UI pages, actions and codes. */
export function buildSections(all: HelpTopic[] = listTopics()): HelpNavSection[] {
  const guides = GUIDES.map(([id, icon]) => ({
    id,
    icon,
    topics: all
      .filter((t) => (t.area === "getting-started" || t.area === "shortcuts") && t.section === id)
      .sort(byGuideOrder),
    groups: [],
  }));
  const pages = all.filter((t) => t.area === "pages");
  const actions = all.filter((t) => t.area === "actions");
  const codes = all.filter((t) => t.area === "codes");
  return [
    ...guides,
    {
      id: "pages",
      icon: LayoutDashboard,
      topics: [],
      groups: groupBy(pages, (t) => t.section || "ui-other", UI_GROUPS),
    },
    {
      id: "actions",
      icon: MousePointerClick,
      topics: [],
      groups: groupBy(actions, (t) => actionGroupOf(t.id), []),
    },
    {
      id: "codes",
      icon: ShieldAlert,
      topics: [],
      groups: groupBy(
        codes,
        (t) => codeGroupOf(t.id),
        CODE_GROUPS.map(([g]) => g),
      ),
    },
  ];
}

const GROUP_ICONS: Record<string, LucideIcon> = {
  "ui-catalog": Library,
  "ui-workspace": UserRound,
  "ui-review": ClipboardCheck,
  "ui-admin": Shield,
  "ui-other": Compass,
  "codes-errors": CircleX,
  "codes-warnings": TriangleAlert,
  "codes-quality": Gauge,
};

export function groupIcon(groupId: string): LucideIcon | undefined {
  return GROUP_ICONS[groupId];
}

/** Topics of a section in nav order (groups flattened). */
export function sectionTopics(s: HelpNavSection): HelpTopic[] {
  return s.topics.length > 0 ? s.topics : s.groups.flatMap((g) => g.topics);
}

export type TopicPlace = {
  section: HelpNavSection;
  group?: HelpNavGroup;
  prev?: HelpTopic;
  next?: HelpTopic;
};

/** Where a topic sits in the tree, with its neighbours inside the same section (or group). */
export function placeOf(id: string, sections: HelpNavSection[]): TopicPlace | undefined {
  for (const section of sections) {
    const group = section.groups.find((g) => g.topics.some((t) => t.id === id));
    const siblings = group ? group.topics : section.topics;
    const i = siblings.findIndex((t) => t.id === id);
    if (i === -1) continue;
    return { section, group, prev: siblings[i - 1], next: siblings[i + 1] };
  }
  return undefined;
}
