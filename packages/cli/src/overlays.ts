import { createHash } from "node:crypto";
import type { UnzippedFile } from "./bundle.ts";
import type { SkillforgeClient } from "./client.ts";

/**
 * Layers of edits over an artifact (artifact-overlays): company → the person's teams → the person. Applied after the
 * bundle signature is checked, so the signed files stay verifiable and the edits survive every update.
 */
export type OverlayOp = { op: "append" | "replace" | "add"; path: string; text: string };
export type Layer = { scope: string; ops: OverlayOp[] };

/** The layers that apply to the caller; none for anonymous installs or registries without layers. */
export async function fetchLayers(
  client: SkillforgeClient,
  type: string,
  name: string,
): Promise<Layer[]> {
  if (type !== "skill" && type !== "command" && type !== "agent") return [];
  const res = await client.request(
    "GET",
    `/api/v1/artifacts/${encodeURIComponent(type)}/${encodeURIComponent(name)}/overlays`,
  );
  if (!res.ok) return [];
  const layers = (res.data as { layers?: Layer[] }).layers;
  return Array.isArray(layers) ? layers.map((l) => ({ scope: l.scope, ops: l.ops })) : [];
}

/** Fingerprint kept in the lock: a changed layer reinstalls even when the version is the same. */
export function layersDigest(layers: readonly Layer[]): string | undefined {
  if (layers.length === 0) return undefined;
  return createHash("sha256").update(JSON.stringify(layers)).digest("hex");
}

/** Applies the layers in order; append/replace to a file the version does not have is skipped with a warning. */
export function applyLayers(
  files: readonly UnzippedFile[],
  layers: readonly Layer[],
  warn: (message: string) => void,
): UnzippedFile[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  for (const layer of layers) {
    for (const op of layer.ops) {
      const current = byPath.get(op.path);
      if (op.op === "add" || (op.op === "replace" && current)) {
        byPath.set(op.path, Buffer.from(op.text, "utf8"));
      } else if (op.op === "append" && current) {
        byPath.set(op.path, Buffer.concat([current, Buffer.from(op.text, "utf8")]));
      } else {
        warn(`warning: layer ${layer.scope}: ${op.path} is not in this version, ${op.op} skipped`);
      }
    }
  }
  return [...byPath].map(([path, content]) => ({ path, content }));
}
