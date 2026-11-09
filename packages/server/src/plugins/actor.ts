import type { Database } from "../db.ts";
import { getUserByUsername } from "../auth/users.ts";
import type { PluginActor } from "./events.ts";

/** Resolve username (publish/transition actor string) to plugin event actor. */
export function actorFromUsername(db: Database, username: string | null | undefined): PluginActor {
  if (!username || username === "anonymous") return null;
  const user = getUserByUsername(db, username);
  if (!user) return { id: "", username };
  return { id: user.id, username: user.username };
}
