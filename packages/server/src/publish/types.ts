import type { RubricResult } from "../quality/rubric.ts";
import type {
  AgentDeclaration,
  ArtifactType,
  PluginComponent,
  Issue,
  ParsedArtifact,
  QualityReport,
} from "@skillforge/core";
import type { Database } from "../repo.ts";
import type { ArtifactSummary, VersionDetail } from "../repo.ts";
import type { Role } from "../auth/users.ts";
import type { Channel } from "../versions/channels.ts";
import type { RegistryDuplicate } from "../duplicates/registry.ts";

export const PROVENANCE_SOURCES = new Set([
  "human",
  "reckon",
  "agentspace",
  "dreamteam",
  "import",
  "agent",
  "harvest",
]);

export type PublishCtx = {
  db: Database;
  dataDir: string;
  actor: string;
  role: Role;
};

export type PublishRequestBody = {
  type?: unknown;
  /** artifact-agent-compat: `[{runtime, min_version?}]` or `"claude-code>=2.1,codex"`. */
  agents?: unknown;
  name?: unknown;
  description?: unknown;
  version?: unknown;
  changelog?: unknown;
  provenance?: unknown;
  model_compat?: unknown;
  files?: unknown;
  channel?: unknown;
  visibility?: unknown;
  owner_team?: unknown;
};

export type ConflictKind =
  "version_invalid" | "channel_invalid" | "version_exists" | "digest_exists" | "not_owner";

export type ValidateArtifactView = {
  type: ArtifactType;
  name: string;
  description: string;
  display_name: string | null;
  tags: string[];
  files: Array<{ path: string; sha256: string; size: number }>;
  digest: string;
  components?: PluginComponent[];
};

export type ValidateExistingView = {
  latest_version: string | null;
  versions_count: number;
  status: string;
};

export type PrepareOk = {
  kind: "prepared";
  ok: boolean;
  detected_type: ArtifactType | null;
  type: ArtifactType | null;
  artifact: ValidateArtifactView | null;
  errors: Issue[];
  warnings: Issue[];
  /** Advisory quality report; present only when parse succeeded. Never blocks publication. */
  quality: QualityReport | null;
  /** quality-rubric: score by company and team rules; null when they are off or parse failed. */
  rubric?: RubricResult | null;
  /** Body fingerprint of the main file; present only when parse succeeded. */
  body_sha256: string | null;
  /** Advisory duplicates against other artifacts; empty when parse failed. Never blocks publication. */
  duplicates: RegistryDuplicate[];
  existing: ValidateExistingView | null;
  next_version: string | null;
  conflicts: ConflictKind[];
  /** Owner of the existing artifact when a publish would hit `not_owner`. */
  existingOwner: string | null;
  /** Optional import audit metadata attached by import run. */
  importMeta?: { kind: string; ref: string; import_id: string; age_override?: string };
  /** Present when parse succeeded — used by commitPublish. */
  parsed: ParsedArtifact | null;
  version: string | null;
  channel: Channel | null;
  /** True when request body set channel explicitly. */
  channelExplicit: boolean;
  changelog: string | null;
  modelCompat: string[];
  /** Normalized publish scope for a FIRST publication (ignored for existing artifacts). */
  visibility: string;
  ownerTeam: string | null;
  /** artifact-agent-compat: parsed declaration (set by prepareArtifactPublish once the type is known). */
  agents?: AgentDeclaration[];
};

export type PrepareResult = PrepareOk | { kind: "bad_request"; message: string };

export type PublishResult =
  | {
      kind: "created";
      artifact: ArtifactSummary;
      version: VersionDetail;
      warnings: Issue[];
      quality: QualityReport | null;
      rubric?: RubricResult | null;
      duplicates: RegistryDuplicate[];
    }
  | { kind: "validation_failed"; errors: Issue[]; warnings: Issue[] }
  | { kind: "version_invalid" }
  | { kind: "channel_invalid" }
  | { kind: "provenance_invalid" }
  | { kind: "version_exists" }
  | { kind: "digest_exists" }
  | { kind: "content_purged" }
  | { kind: "name_purged" }
  | { kind: "not_owner"; owner?: string }
  | { kind: "team_required" }
  | { kind: "team_unknown" }
  | { kind: "not_team_member" }
  | { kind: "bad_request"; message: string }
  | { kind: "agents_invalid"; detail: string }
  | { kind: "eval_gate_required" };
