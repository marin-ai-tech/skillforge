/**
 * One rule for every place that guesses a secret by a variable name (MCP configs, settings profiles):
 * `<NAME>_FILE`, `_PATH`, `_DIR` by convention say where the secret is, not what it is (fix-mcp-path-secret,
 * fix-settings-path-secret). A key-shaped value is still a secret — the caller checks that first.
 */
const PATH_NAME_RE = /_(?:FILE|PATH|DIR)$/i;
/** No whitespace; rooted (`/`, `~/`, `./`, `../`, a drive letter) or containing a separator. */
const PATH_VALUE_RE = /^(?=\S+$)(?:\/|~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|.*[\\/])/;

/** A literal path under a `_FILE`/`_PATH`/`_DIR` name (`-` read as `_`). */
export function isPathToSecret(name: string, value: unknown): boolean {
  return (
    typeof value === "string" &&
    PATH_NAME_RE.test(name.replace(/-/g, "_")) &&
    PATH_VALUE_RE.test(value)
  );
}
