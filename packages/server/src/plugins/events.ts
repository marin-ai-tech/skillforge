import { pluginRegistry } from "./registry.ts";

export type PluginActor = { id: string; username: string } | null;

export type PluginEvent =
  | {
      type: "artifact.purged";
      at: string;
      artifact: { id: string; type: string; name: string };
      version: string | null;
    }
  | {
      type: "comment.created";
      at: string;
      comment: {
        id: string;
        artifact: { type: string; name: string };
        version: string | null;
        parent_id: string | null;
        author: string;
        ref: string | null;
        excerpt: string;
      };
      mentions: string[];
    }
  | {
      type: "notification.created";
      at: string;
      notification: {
        id: string;
        username: string;
        kind: string;
        artifact: { type: string; name: string } | null;
        title: string;
        url: string;
      };
    }
  | {
      type: "artifact.published";
      at: string;
      actor: PluginActor;
      artifact: {
        id: string;
        type: string;
        name: string;
        status: string;
        owner: string;
        override: boolean;
      };
      version: { version: string; digest: string };
    }
  | {
      type: "artifact.transitioned";
      at: string;
      actor: PluginActor;
      artifact: { id: string; type: string; name: string; status: string };
      from: string;
      to: string;
      reason: string | null;
    }
  | {
      type: "version.validated";
      at: string;
      actor: PluginActor;
      artifact: { id: string; type: string; name: string; status: string };
      version: { version: string; digest: string };
    }
  | {
      type: "auth.login";
      at: string;
      user: { id: string; username: string; role: string };
    }
  | {
      type: "server.started";
      at: string;
      version: string;
    }
  | {
      type: "agent.scanned";
      at: string;
      actor: PluginActor;
      agent: { id: string; name: string; kind: string; runtime: string | null };
      owner: { id: string; username: string };
      summary: {
        local_only: number;
        in_sync: number;
        outdated: number;
        modified: number;
        registry_only: number;
      };
    };

type Handler = (evt: PluginEvent) => void | Promise<void>;

const handlers = new Map<string, Array<{ plugin: string; handler: Handler }>>();

export function resetPluginEventHandlers(): void {
  handlers.clear();
}

export function subscribePluginEvent(pluginName: string, type: string, handler: Handler): void {
  const list = handlers.get(type) ?? [];
  list.push({ plugin: pluginName, handler });
  handlers.set(type, list);
  const state = pluginRegistry.get(pluginName);
  if (state && !state.contributions.events.includes(type)) {
    state.contributions.events.push(type);
  }
}

/** Remove all event handlers registered by a plugin (rollback on register failure). */
export function unsubscribePlugin(name: string): void {
  for (const [type, list] of handlers) {
    const next = list.filter((h) => h.plugin !== name);
    if (next.length === 0) handlers.delete(type);
    else handlers.set(type, next);
  }
}

/** Emit after COMMIT; handlers run via setImmediate, isolated with try/catch. */
export function emitPluginEvent(evt: PluginEvent): void {
  const list = handlers.get(evt.type) ?? [];
  if (list.length === 0) return;
  setImmediate(() => {
    for (const { plugin, handler } of list) {
      try {
        const result = handler(evt);
        if (result && typeof (result as Promise<void>).then === "function") {
          (result as Promise<void>).catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[plugin ${plugin}] event handler error: ${msg}`);
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[plugin ${plugin}] event handler error: ${msg}`);
      }
    }
  });
}
