import { useQuery } from "@tanstack/react-query";
import { listRuntimes } from "../api/client.ts";

export type RuntimeOption = { value: string; label: string };

/** Label for agents that do not follow any runtime of the table. */
export const GENERIC_RUNTIME: RuntimeOption = { value: "generic", label: "Generic" };

/**
 * Runtime options for agent snapshots: the server runtime table (`GET /api/v1/runtimes`) plus `generic`.
 * The web has no dependency on the core, so the list is never hard-coded here. While the table loads or when the
 * request fails, the select still offers `generic` and the current value.
 */
export function useAgentRuntimeOptions(current: string): RuntimeOption[] {
  const query = useQuery({ queryKey: ["runtimes"], queryFn: listRuntimes, staleTime: 5 * 60_000 });
  const options: RuntimeOption[] = (query.data?.items ?? [])
    .filter((r) => r.id !== GENERIC_RUNTIME.value)
    .map((r) => ({ value: r.id, label: r.label || r.id }));
  options.push(GENERIC_RUNTIME);
  if (current && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: current });
  }
  return options;
}

/** Agent label by runtime id from the server table (`GET /api/v1/runtimes`); the id while the table loads. */
export function useRuntimeLabels(): { label: (id: string) => string; ids: string[] } {
  const query = useQuery({ queryKey: ["runtimes"], queryFn: listRuntimes, staleTime: 5 * 60_000 });
  const items = query.data?.items ?? [];
  return {
    label: (id: string) => items.find((r) => r.id === id)?.label || id,
    ids: items.map((r) => r.id),
  };
}

/** `claude-code>=2.1, codex` — the editable text form of an agent declaration (same as the CLI flag). */
export function formatDeclaration(
  list: ReadonlyArray<{ runtime: string; min_version: string | null }>,
): string {
  return list.map((d) => (d.min_version ? `${d.runtime}>=${d.min_version}` : d.runtime)).join(", ");
}
