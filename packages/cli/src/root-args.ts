export type RootVersionRequest = { json: boolean };

export function parseRootVersionArgs(argv: readonly string[]): RootVersionRequest | null {
  let version = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) break;
    if (arg === "--") break;
    if (!arg.startsWith("-")) break;

    if (arg === "--version" || arg === "-V") {
      version = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--no-color") {
      continue;
    } else if (arg === "--url" || arg === "--token") {
      i += 1;
    }
  }

  return version ? { json } : null;
}
