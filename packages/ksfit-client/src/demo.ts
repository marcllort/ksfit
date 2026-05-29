/**
 * Synthetic data for KSFIT_DEMO=1 mode. Used to render the dashboard with
 * plausible-looking activity without needing real KS Fit credentials.
 *
 * Everything here is deterministic (seeded PRNG) so screenshots are stable.
 */
import type {
  Device,
  SportRecord,
  UserInfo,
  WeightEntry,
} from "./ksfit";
import {
  CONSUME_SCALE,
  normalizeAll,
  normalizeWeights,
  type DashboardData,
} from "./data";

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MODELS = ["WalkingPad P2", "WalkingPad R2", "WalkingPad C2"];
const COURSES = [
  "",
  "",
  "Morning Mile",
  "Easy Pace",
  "Brisk Walk",
  "Lunch Loop",
  "Recovery 30",
  "Hill Mix",
  "",
];

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function fmtTs(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

function buildSessions(): SportRecord[] {
  const rng = mulberry32(0xc0ffee);
  const out: SportRecord[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const DAYS = 180;
  let counter = 1000;

  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 86_400_000);
    const dow = day.getUTCDay();
    // Active ~5-6 days per week. Skip ~15% randomly, and almost-always rest Sunday.
    const skipChance = dow === 0 ? 0.55 : 0.15;
    if (rng() < skipChance) continue;
    // Today: a fresh morning session so the "Today" panel always has data.
    const sessionsToday = i === 0 ? 1 : rng() < 0.18 ? 2 : 1;

    for (let s = 0; s < sessionsToday; s++) {
      // Plausible session shape: ~20-55 min, ~3-6 km, ~3-7k steps.
      const minutes = 18 + Math.floor(rng() * 38);
      const speed = 4.2 + rng() * 2.0; // 4.2-6.2 km/h
      const km = (minutes / 60) * speed;
      const distanceM = Math.round(km * 1000);
      const durationSec = minutes * 60;
      const stepsPerKm = 1300 + Math.floor(rng() * 200);
      const steps = Math.round(km * stepsPerKm);
      const kcalKm = 55 + rng() * 12;
      const kcal = Math.round(km * kcalKm * CONSUME_SCALE); // raw consume units
      const heart = 92 + Math.floor(rng() * 36);
      const hour = s === 0 ? 7 + Math.floor(rng() * 3) : 18 + Math.floor(rng() * 3);
      const minute = Math.floor(rng() * 60);
      const start = new Date(day.getTime());
      start.setUTCHours(hour, minute, 0, 0);

      counter += 1;
      out.push({
        detailid: `${counter}`,
        did: "DEMO-DEVICE-01",
        run_id: `demo-${counter}`,
        distance: String(distanceM),
        time: String(durationSec),
        consume: String(kcal),
        steps: String(steps),
        model: MODELS[counter % MODELS.length],
        start_time: fmtTs(start),
        add_time: fmtTs(start),
        heart: String(heart),
        slope_max: "0",
        power: "0",
        resistance: "0",
        product_id: "1",
        course_name: COURSES[Math.floor(rng() * COURSES.length)] ?? "",
        course_id: null,
        course_type: "0",
        device_type: null,
        is_iwatch: 0,
        floors: "0",
        timezone_offset_minute: "0",
        target_type: null,
        target_value: null,
      });
    }
  }
  return out;
}

function buildWeights(): WeightEntry[] {
  const rng = mulberry32(0xfeed);
  const today = new Date();
  today.setUTCHours(8, 30, 0, 0);
  const out: WeightEntry[] = [];
  // ~one entry every 3-4 days for 6 months, with a gentle downward trend.
  let day = 180;
  let w = 78.4;
  let id = 1;
  while (day >= 0) {
    w -= 0.05 + rng() * 0.18; // small daily drift down
    w += (rng() - 0.5) * 0.6; // noise
    const when = new Date(today.getTime() - day * 86_400_000);
    const height = 1.78;
    const bmi = w / (height * height);
    out.push({
      id: String(id++),
      weight: w.toFixed(1),
      BMI: bmi.toFixed(2),
      add_time: fmtTs(when),
      fat: (18 + rng() * 4).toFixed(1),
      waterRate: (55 + rng() * 3).toFixed(1),
      bmr: String(1500 + Math.floor(rng() * 200)),
      visceralFat: String(5 + Math.floor(rng() * 4)),
      muscleVolume: (52 + rng() * 4).toFixed(1),
      bodyAge: String(28 + Math.floor(rng() * 6)),
    });
    day -= 3 + Math.floor(rng() * 2);
  }
  return out;
}

function buildDevices(): { list: Device[]; share_list: Device[] } {
  return {
    list: [
      {
        did: "DEMO-DEVICE-01",
        xj_id: "demo-user",
        model: "WalkingPad P2",
        bind_time: "2025-11-04 09:12:00",
        add_time: "2025-11-04 09:12:00",
        productId: "1",
        name: "Office treadmill",
      },
    ],
    share_list: [],
  };
}

const USER: UserInfo = {
  xjid: "demo-user",
  nickname: "Alex",
  gender: "1",
  avatar: "",
  height: 178,
  weight: 76.0,
  birthday: "1992-04-12",
  my_slogan: "One step at a time.",
};

let cached: DashboardData | null = null;

export function getDemoData(): DashboardData {
  if (cached) return cached;
  const rawSessions = buildSessions();
  const rawWeights = buildWeights();
  cached = {
    user: USER,
    sessions: normalizeAll(rawSessions),
    weights: normalizeWeights(rawWeights),
    devices: buildDevices(),
  };
  return cached;
}

export function getDemoSessions() {
  const d = getDemoData();
  return { user: d.user, sessions: d.sessions };
}

/** Synthetic per-second telemetry for any demo run_id. */
export function getDemoRecordPoints(runId: string) {
  const sessions = getDemoData().sessions;
  const s = sessions.find((x) => x.runId === runId) ?? sessions[0];
  if (!s) return { point: { point_list: "" } };
  const rng = mulberry32(
    Array.from(s.runId).reduce((a, c) => a + c.charCodeAt(0), 0),
  );
  const targetSpeed = (s.distanceM / 1000) / (s.durationSec / 3600);
  const points: number[][] = [];
  let cumDist = 0;
  let cumKcal = 0;
  let cumSteps = 0;
  // 1 sample / 5 seconds keeps the chart smooth without 3000 rows.
  for (let t = 0; t <= s.durationSec; t += 5) {
    const ramp = t < 60 ? t / 60 : t > s.durationSec - 60 ? Math.max(0.1, (s.durationSec - t) / 60) : 1;
    const speed = Math.max(0, targetSpeed * ramp + (rng() - 0.5) * 0.6);
    const incDist = (speed * 1000) / 720; // metres per 5s tick
    cumDist += incDist;
    cumKcal += (speed * 1000 / 720) * (60 / 1000); // ~60 kcal/km
    cumSteps += (incDist * (1300 + rng() * 150)) / 1000;
    const cadence = Math.round(80 + speed * 14 + (rng() - 0.5) * 8);
    points.push([
      Math.round(speed * 10),
      t,
      Math.round(cumSteps),
      Math.round(cumDist),
      Math.round(cumKcal * 1000),
      cadence,
    ]);
  }
  const inner = JSON.stringify({ pointsData: points });
  return { point: { point_list: inner } };
}
