/**
 * Server-side fetchers that combine a Session with the typed `ksfit` calls and
 * normalize the payload. Pages call these once per request.
 */
import { ksfit, type SportRecord, type Session } from "@stride/ksfit-client";
import { ensureRotationPersist, requireSession } from "./session";
import { withCache } from "./cache";
import {
  normalizeAll,
  normalizeWeights,
  getDemoData,
  getDemoRecordPoints,
  getDemoSessions,
  type DashboardData,
} from "@stride/ksfit-client";

const DEMO = process.env.KSFIT_DEMO === "1";

// TTL budget per resource. Records are the only thing that changes during a
// session (a workout finishes → new entry), so they get the shortest TTL.
// Everything else is effectively static for the user.
const TTL = {
  user: 5 * 60_000,
  records: 60_000,
  weights: 5 * 60_000,
  devices: 60 * 60_000,
  points: 24 * 60 * 60_000,
} as const;

const k = (xjid: string, kind: string) => `user:${xjid}:${kind}`;

/** Per-session telemetry (record_points) is immutable once a workout has
 *  ended, so we cache it for a day. The first visit to a session-detail
 *  page hits KS Fit; every subsequent visit is local-only. */
export async function fetchRecordPoints(session: Session, runId: string) {
  if (DEMO) return getDemoRecordPoints(runId);
  return withCache(
    k(session.xjid, `points:${runId}`),
    TTL.points,
    () => ksfit.recordPoints(session, runId),
  );
}

/** Cached profile + sessions list, used by every page that doesn't need
 *  weight history or device info. Avoids the heavier `fetchAll()`. */
export async function fetchSessions(session: Session) {
  if (DEMO) return getDemoSessions();
  ensureRotationPersist(session);
  const user = await withCache(k(session.xjid, "user"), TTL.user, () =>
    ksfit.userInfo(session),
  );
  const sport = await withCache(k(session.xjid, "records"), TTL.records, () =>
    ksfit.sportRecords(session),
  );
  const records: SportRecord[] =
    (sport as { record?: SportRecord[] })?.record ?? [];
  return { user, sessions: normalizeAll(records) };
}

export async function fetchAll(): Promise<DashboardData> {
  if (DEMO) return getDemoData();
  const session = await requireSession();
  ensureRotationPersist(session);

  // All four upstream calls go through the in-process cache. A cache hit
  // means zero KS Fit traffic for repeat page renders within the TTL.
  // On miss we serialize the upstream fetches — parallelizing them races the
  // 402 token rotation (each parallel call gets a different fresh JWT and the
  // retries collide).
  const user = await withCache(k(session.xjid, "user"), TTL.user, () =>
    ksfit.userInfo(session),
  );
  const sport = await withCache(k(session.xjid, "records"), TTL.records, () =>
    ksfit.sportRecords(session),
  );
  const weights = await withCache(
    k(session.xjid, "weights"),
    TTL.weights,
    () => ksfit.weightLog(session).catch(() => [] as never[]),
  );
  const devices = await withCache(
    k(session.xjid, "devices"),
    TTL.devices,
    () =>
      ksfit
        .devices(session)
        .catch(() => ({ list: [], share_list: [] })),
  );
  // sport_records may return null when the user has no records; handle.
  const records: SportRecord[] = (sport as { record?: SportRecord[] })?.record ?? [];
  return {
    user,
    sessions: normalizeAll(records),
    weights: normalizeWeights(Array.isArray(weights) ? weights : []),
    devices,
  };
}
