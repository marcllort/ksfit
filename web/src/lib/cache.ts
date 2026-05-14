/**
 * In-process TTL cache for upstream KS Fit responses.
 *
 * We deliberately keep this in-memory (a single `Map`) instead of using
 * `unstable_cache`, because the latter can't observe `cookies()` and would
 * therefore require us to expose the JWT token as a cache key — leaking it
 * into Next's persistent cache layer. Per-process memory is the safer place
 * for any byproduct of a logged-in user's session.
 *
 * Each cache entry is keyed on `${kind}:${xjid}` so users never see each
 * other's data, and the entry value is the already-parsed response object.
 */

type Entry = { at: number; data: unknown };
const store = new Map<string, Entry>();

/**
 * Best-effort upper bound. KS Fit has ~30 endpoints we care about and
 * ksfit-web is single-user-per-session, so this cap is mostly a safety net
 * against pathological key cardinality.
 */
const MAX_ENTRIES = 1000;

function set(key: string, data: unknown) {
  if (store.size >= MAX_ENTRIES) {
    // Drop the oldest 10% to keep amortised cost down.
    const drop = Math.ceil(MAX_ENTRIES * 0.1);
    let i = 0;
    for (const k of store.keys()) {
      if (i++ >= drop) break;
      store.delete(k);
    }
  }
  store.set(key, { at: Date.now(), data });
}

export async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    if (process.env.KSFIT_TRACE) {
      console.log(`[cache] HIT ${key} (${Date.now() - hit.at}ms old)`);
    }
    return hit.data as T;
  }
  if (process.env.KSFIT_TRACE) {
    console.log(`[cache] MISS ${key} (store.size=${store.size})`);
  }
  const data = await fn();
  set(key, data);
  return data;
}

/** Invalidate every cache entry whose key starts with `${prefix}`. */
export function invalidate(prefix: string) {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Drop everything cached for a specific user. */
export function invalidateUser(xjid: string) {
  invalidate(`user:${xjid}:`);
}
