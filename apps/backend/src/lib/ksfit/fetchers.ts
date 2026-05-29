/**
 * Server-side KS Fit fetchers (backend). Ported from
 * apps/web/src/lib/fetchers.ts. Take an already-resolved Session (the route
 * resolves it from the Hono context), so these stay framework-free.
 * Rotation persistence is wired by requireSession() before these are called.
 */
import {
  ksfit,
  normalizeAll,
  normalizeWeights,
  getDemoData,
  getDemoRecordPoints,
  getDemoSessions,
  type DashboardData,
  type Session,
  type SportRecord,
} from "@stride/ksfit-client";
import { withCache } from "../cache.ts";

const DEMO = process.env.KSFIT_DEMO === "1";

const TTL = {
  user: 5 * 60_000,
  records: 60_000,
  weights: 5 * 60_000,
  devices: 60 * 60_000,
  points: 24 * 60 * 60_000,
} as const;

const k = (xjid: string, kind: string) => `user:${xjid}:${kind}`;

export async function fetchRecordPoints(session: Session, runId: string) {
  if (DEMO) return getDemoRecordPoints(runId);
  return withCache(k(session.xjid, `points:${runId}`), TTL.points, () =>
    ksfit.recordPoints(session, runId),
  );
}

export async function fetchSessions(session: Session) {
  if (DEMO) return getDemoSessions();
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

export async function fetchAll(session: Session): Promise<DashboardData> {
  if (DEMO) return getDemoData();
  // Serialized on purpose: parallel calls race KS Fit's in-place 402 token
  // rotation (each gets a different fresh JWT and the retries collide).
  const user = await withCache(k(session.xjid, "user"), TTL.user, () =>
    ksfit.userInfo(session),
  );
  const sport = await withCache(k(session.xjid, "records"), TTL.records, () =>
    ksfit.sportRecords(session),
  );
  const weights = await withCache(k(session.xjid, "weights"), TTL.weights, () =>
    ksfit.weightLog(session).catch(() => [] as never[]),
  );
  const devices = await withCache(k(session.xjid, "devices"), TTL.devices, () =>
    ksfit.devices(session).catch(() => ({ list: [], share_list: [] })),
  );
  const records: SportRecord[] =
    (sport as { record?: SportRecord[] })?.record ?? [];
  return {
    user,
    sessions: normalizeAll(records),
    weights: normalizeWeights(Array.isArray(weights) ? weights : []),
    devices,
  };
}
