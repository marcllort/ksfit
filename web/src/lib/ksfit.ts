/**
 * KS Fit (Kingsmith) cloud API — server-side TypeScript client.
 *
 *   POST https://eu.api.ks.fit/V0.1/index.php
 *   JSON body  ➜ {"service": "<Class>.<method>", ...params}
 *   Login auth ➜ email + md5(password) hex
 *   Session    ➜ xjid + token (JWT, ~90 day expiry)
 *
 * Ported from the project's Python client (ksfit/client.py). Read-only.
 */
import { createHash } from "node:crypto";

const BASE_URL =
  process.env.KSFIT_BASE_URL ?? "https://eu.api.ks.fit/V0.1/index.php";

export class KSFitError extends Error {
  ret: number;
  code: string | null;
  raw: unknown;
  constructor(ret: number, code: string | null, message: string, raw: unknown) {
    super(`ret=${ret} code=${code ?? "-"} ${message}`);
    this.ret = ret;
    this.code = code;
    this.raw = raw;
    this.name = "KSFitError";
  }
}

export interface Session {
  xjid: string;
  token: string;
  /** Optional hook called when KS Fit rotates the token mid-request. */
  onRotate?: (token: string) => void | Promise<void>;
}

type Envelope = {
  ret: number;
  msg?: string;
  data?: { code?: string | number; info?: unknown; msg?: string };
};

async function post(
  service: string,
  params: Record<string, unknown>,
): Promise<Envelope> {
  const body = JSON.stringify({ service, ...params });
  const started = process.env.KSFIT_TRACE ? Date.now() : 0;
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // KS Fit responses are user-specific; never let Next cache them at the
    // fetch layer (we cache one layer up, keyed on xjid, in lib/cache.ts).
    cache: "no-store",
  });
  if (process.env.KSFIT_TRACE) {
    console.log(
      `[ksfit] ${service} ${res.status} ${Date.now() - started}ms`,
    );
  }
  if (!res.ok) {
    throw new KSFitError(res.status, null, `HTTP ${res.status}`, null);
  }
  return (await res.json()) as Envelope;
}

function check<T = unknown>(j: Awaited<ReturnType<typeof post>>): T {
  const ret = j.ret;
  const data = j.data && typeof j.data === "object" ? j.data : {};
  const code = String(data.code ?? "0");
  if (ret !== 200) {
    throw new KSFitError(ret, code, j.msg ?? "", j);
  }
  // PhalApi: 0 = ok, 15 = soft empty (info == null).
  if (code !== "0" && code !== "15") {
    throw new KSFitError(
      ret,
      code,
      (data.msg as string) ?? j.msg ?? "request failed",
      j,
    );
  }
  return data.info as T;
}

export async function login(
  email: string,
  password: string,
): Promise<Session & { info: Record<string, unknown> }> {
  const pwmd5 = createHash("md5").update(password, "utf8").digest("hex");
  const j = await post("user.login", { email, pwd: pwmd5 });
  const info = check<Record<string, unknown> & { xjid: string; token: string }>(
    j,
  );
  return { xjid: info.xjid, token: info.token, info };
}

export async function call<T = unknown>(
  session: Session,
  service: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const j = await post(service, {
    xjid: session.xjid,
    token: session.token,
    ...params,
  });

  // ret=402 is "token nearing expiry" — the rotated token is delivered as a
  // JSON-encoded string in `msg` (not `data.info`). Parse it, swap the
  // session token in-place, then re-issue the call transparently.
  if (j.ret === 402 && typeof j.msg === "string") {
    let info: { token?: string; refresh_token?: string } | null = null;
    try {
      info = JSON.parse(j.msg);
    } catch {
      /* not a rotation envelope */
    }
    if (info?.token) {
      session.token = info.token;
      try {
        await session.onRotate?.(info.token);
      } catch {
        /* best-effort */
      }
      const retry = await post(service, {
        xjid: session.xjid,
        token: session.token,
        ...params,
      });
      return check<T>(retry);
    }
  }

  return check<T>(j);
}

/* ---------- typed convenience wrappers ---------------------------------- */

export interface UserInfo {
  xjid: string;
  nickname: string;
  gender: string;
  avatar: string;
  province?: string;
  city?: string;
  my_slogan?: string;
  height: string | number;
  weight: string | number;
  birthday: string;
  email?: string;
}

export interface SportRecord {
  detailid: string;
  did: string;
  run_id: string;
  distance: string; // meters
  time: string; // seconds
  consume: string; // kcal × 10
  steps: string;
  model: string;
  start_time: string; // "YYYY-MM-DD HH:MM:SS"
  add_time: string;
  heart: string;
  slope_max: string;
  power: string;
  resistance: string;
  product_id: string;
  course_name: string;
  course_id?: string | null;
  course_type: string;
  device_type?: string | null;
  is_iwatch: string | number;
  iw_consume?: string | null;
  iw_step?: string | null;
  iw_oxygen?: string | null;
  iw_heart?: string | null;
  iw_pace?: string | null;
  floors?: string;
  timezone_offset_minute?: string;
  target_type?: string | null;
  target_value?: string | null;
  mac?: string;
  oar_frequency?: string;
}

export interface WeightEntry {
  id: string;
  weight: string;
  BMI: string;
  add_time: string;
  fat: string;
  waterRate: string;
  bmr: string;
  visceralFat: string;
  muscleVolume: string;
  bodyAge: string;
}

export interface Device {
  did: string;
  xj_id: string;
  model: string;
  bind_time: string;
  add_time: string;
  productId: string;
  name: string;
  cacheJson?: string;
  protocol_type?: string;
}

export interface RecordPoints {
  point_list?: string;
  heart_list?: string;
  slope_list?: string;
  speed_list?: string;
  step_list?: string;
  cadence_list?: string;
  // The cloud actually returns a single "point" wrapper with a packed list:
  // see record.getRecordPoint dump. We keep the shape loose.
  [key: string]: unknown;
}

export const ksfit = {
  userInfo: (s: Session) => call<UserInfo>(s, "user.info"),
  sportRecords: (s: Session, sinceTimestamp = 0) =>
    call<{ record: SportRecord[]; timestamp: number }>(
      s,
      "record.GetAllRecords",
      { timestamp: sinceTimestamp },
    ),
  recordPoints: (s: Session, runId: string) =>
    call<{ point: RecordPoints } | RecordPoints>(s, "record.getRecordPoint", {
      run_id: runId,
    }),
  weightLog: (s: Session) => call<WeightEntry[]>(s, "user.weightLog"),
  devices: (s: Session) =>
    call<{ list: Device[]; share_list?: Device[] }>(s, "box.deviceList"),
  schedules: (s: Session) => call<unknown[]>(s, "schedule.listMy"),
  courseHistory: (s: Session) =>
    call<{ list: Array<Record<string, unknown>> }>(s, "lesson.personal"),
};
