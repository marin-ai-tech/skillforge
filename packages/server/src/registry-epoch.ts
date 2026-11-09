/**
 * In-process "registry epoch".
 *
 * Caches whose result depends on the registry (artifacts, versions, statuses, purge), on visibility
 * (team membership, maintainers, owner, scope) or on agent snapshots key their entries by this epoch.
 * Every write that can change such a result calls `bumpRegistryEpoch()`; an entry built under an older
 * epoch is never served again. Call it right after the write (in the same synchronous section as the
 * statement or right after COMMIT): node:sqlite is synchronous, so no request can read in between.
 * A bump inside a transaction that later rolls back is harmless (only an extra cache miss).
 */
let registryEpoch = 0;

export function bumpRegistryEpoch(): void {
  registryEpoch += 1;
}

export function getRegistryEpoch(): number {
  return registryEpoch;
}
