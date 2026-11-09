export const BACKUP_SUFFIXES = [".bak", ".old", ".orig", ".backup", "-backup", "~"] as const;

/**
 * True when any path segment of `root` looks like a backup copy (`note.bak`, `note-backup`,
 * `note~`, or a `*.bak` directory containing the copy). `-old` is deliberately absent:
 * `convert-old` is a legitimate name, not a backup marker.
 */
export function isBackupRoot(root: string): boolean {
  const trimmed = root.replace(/\/+$/u, "");
  return trimmed
    .split("/")
    .some((segment) =>
      BACKUP_SUFFIXES.some((s) => segment.length > s.length && segment.endsWith(s)),
    );
}
