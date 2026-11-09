import type { AppConfig } from "../config.ts";
import type { ArtifactRow, VersionDetail } from "../repo.ts";

export function pluginName(type: string, name: string): string {
  if (type === "skill" || type === "plugin") return name;
  return `${name}-${type}`;
}

export type PluginJson = {
  name: string;
  version: string;
  description: string;
  author: { name: string };
  keywords: string[];
  metadata: {
    skillforge_type: string;
    skillforge_name: string;
    digest: string;
    status: string;
    registry: string;
  };
};

export function buildPluginJson(
  artifact: Pick<ArtifactRow, "type" | "name" | "status" | "description" | "tags">,
  version: Pick<VersionDetail, "version" | "digest" | "description" | "tags" | "published_by">,
  config: Pick<AppConfig, "baseUrl">,
): PluginJson {
  return {
    name: pluginName(artifact.type, artifact.name),
    version: version.version,
    description: version.description || artifact.description || "",
    author: { name: version.published_by },
    keywords: version.tags,
    metadata: {
      skillforge_type: artifact.type,
      skillforge_name: artifact.name,
      digest: version.digest,
      status: artifact.status,
      registry: config.baseUrl.replace(/\/$/, ""),
    },
  };
}
