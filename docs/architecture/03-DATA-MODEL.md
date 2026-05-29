# 03 — Data Model

Status: authoritative design. Aligns with the synthesized engineering plan
(`apps/backend` Hono service, `packages/db` Drizzle layer). This document covers:

1. Whether and why a database is introduced, and which one.
2. The entities/tables.
3. The shared TypeScript types (mirroring and extending today's `HealthProvider` types).
4. The metric-computation pipeline (raw provider data → derived WHOOP-style scores).

Today's code is stateless: KS Fit session, Fitbit tokens, and the push-walk
dedupe ledger all live in **httpOnly cookies**
(`web/src/lib/session.ts`, `web/src/lib/health/fitbit/tokens.ts`,
`web/src/lib/health/fitbit/logged.ts`); upstream responses live in an in-process
TTL `Map` (`web/src/lib/cache.ts`). That is fine for a single browser talking to
a single Next.js process. It breaks the moment we need: server-custodied OAuth
tokens, trend history, coach memory, push subscriptions, and a second client
(iOS) that has no cookie jar.

---

## 1. Database: decision and rationale

**Decision: introduce SQLite via Drizzle ORM in Phase 2.** One file on a mounted
Docker volume so it survives image rebuilds; schema kept Postgres-compatible so a
future move to Postgres is a connection-string + dialect change, not a rewrite.

**Why a DB at all (each is a hard requirement, not a nice-to-have):**

| Need | Why cookies / memory can't do it |
|---|---|
| Server-custodied OAuth tokens, encrypted at rest | A token in an httpOnly cookie lives in the *browser*; iOS has no cookie and the backend can't refresh tokens out-of-band (cron). Must be a server row, AES-GCM encrypted. |
| Daily metric snapshots + trends (HRV baseline, sleep debt, strain, recovery) | WHOOP-style scores are EWMA/rolling-window computations over *weeks* of history. A TTL cache holds hours; cookies can't hold a 90-day series. |
| Push-walk dedupe ledger | Today a 500-id cookie array (`logged.ts`); must be durable and shared across web + iOS + cron. |
| Coach conversation memory | The AI coach needs prior turns; can't fit in a cookie, must be queryable per user. |
| Push subscriptions (Web Push now, APNs later) | Server must store endpoints/keys to send the weekly weight reminder from a cron with no client present. |
| Opaque session tokens (one auth path, two transports) | The backend must validate an incoming token by *hashing and looking it up*; that lookup table is a DB row. |

**Why SQLite specifically:** fits the 384 MB box with no extra process; embedded,
zero-ops, single mounted file; Drizzle gives typed repos + migrations and a
Postgres dialect we mirror so nothing here blocks a later upgrade. The existing
in-memory TTL cache + stampede guard (`cache.ts`) stays in front of the DB as a
hot read layer — the DB is the system of record, the `Map` is the accelerator.

**What does NOT go in the DB:** raw intraday HR series and other large
provider payloads are fetched on demand and held only in the TTL cache. We persist
*derived daily scalars* (snapshots), not megabytes of per-second samples. The DB
stays small and the migration to a different provider doesn't drag a data lake.

---

## 2. Entities / tables

Drizzle schema lives in `packages/db/schema.ts`; typed repos in
`packages/db/repos/*`. All timestamps are Unix epoch **milliseconds** (matching
the existing `HeartRatePoint.t` / `WeightReading.t` convention) stored as
`integer`. All ids are app-generated (UUID/ULID text) so they're stable across
SQLite→Postgres.

### 2.1 `users`
The single self-hosted user today; the column set is multi-user-ready so nothing
structural changes when iOS or a second account arrives.

| column | type | notes |
|---|---|---|
| `id` | text PK | ULID |
| `ksfit_xjid` | text unique | the KS Fit account id; ties our user to upstream |
| `display_name` | text null | |
| `created_at` / `updated_at` | int | epoch ms |
| **Profile (new — required for honest metrics)** | | |
| `birth_date` | text null | `YYYY-MM-DD`; drives age → HRmax, fitness-age norms |
| `sex` | text null | `male` / `female` / `unspecified`; norm tables are sex-specific |
| `height_cm` | real null | |
| `waist_cm` | real null | non-exercise VO2max fallback input |
| `hr_max_override` | int null | if user knows a measured max; else age-derived |

The profile fields are prerequisite #2 from the plan — Recovery, Strain, and
Fitness Age cannot be computed honestly without age/sex/height/waist.

### 2.2 `provider_accounts` (OAuth token custody)
Replaces the `fitbit_tokens` cookie. One row per (user, provider). **Tokens are
AES-GCM encrypted at rest** with `TOKEN_ENC_KEY`; the ciphertext+iv+tag is stored,
never the plaintext.

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `user_id` | text FK → users | |
| `provider` | text | `fitbit` \| `google_health` — the `oauth_type` flag for side-by-side migration |
| `provider_user_id` | text | Fitbit `user_id` / Google sub |
| `access_token_enc` | blob | AES-GCM ciphertext |
| `refresh_token_enc` | blob | AES-GCM ciphertext |
| `enc_iv` / `enc_tag` | blob | per-row nonce + auth tag |
| `expires_at` | int | epoch ms; cron refreshes before this |
| `scope` | text | granted scopes |
| `connected_at` / `updated_at` | int | |

Unique on `(user_id, provider)`. Token refresh moves OFF the request path into a
background cron that reads rows nearing `expires_at`, refreshes, re-encrypts, and
writes back. The `HealthProvider` interface is unchanged — only the persistence
behind `tokens.ts` swaps cookie → this table.

### 2.3 `app_sessions` (opaque session tokens — our auth)
Clients authenticate to *our* backend with a 256-bit opaque token. We store only
its hash, so a DB leak doesn't yield live sessions.

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `user_id` | text FK → users | |
| `token_hash` | text unique | SHA-256 of the opaque token |
| `transport` | text | `cookie` (web) \| `bearer` (iOS) — one validation path, two deliveries |
| `created_at` / `last_seen_at` | int | |
| `expires_at` | int | |
| `revoked_at` | int null | |

`POST /auth/session` (auto-login from env creds, or device pairing for iOS) mints
the token, inserts the hashed row, and returns the plaintext once.

### 2.4 `cached_metrics` (optional durable cache; provider raw-ish)
A persistence-backed mirror of the hot TTL cache for *day-grained* provider reads
(daily activity, sleep summary, day HR summary) so a process restart or the cron
doesn't re-hit a rate-limited provider. **Intraday series are NOT stored here** —
they stay in the in-memory cache only.

| column | type | notes |
|---|---|---|
| `user_id` | text FK | |
| `provider` | text | |
| `kind` | text | `daily_activity` \| `sleep` \| `hr_day` \| `weight` \| `hrv` \| `breathing` \| `spo2` \| `skin_temp` \| `cardio_score` |
| `metric_date` | text | `YYYY-MM-DD` |
| `payload` | text (JSON) | the normalized provider type for that kind |
| `fetched_at` | int | for TTL eviction |

PK `(user_id, provider, kind, metric_date)`. This is the boundary between
"raw provider data" and the derivation pipeline in §4.

### 2.5 `daily_scores` (derived WHOOP-style snapshots)
The heart of the trend system. One row per (user, date) holding every derived
scalar plus the baseline state needed to compute the next day incrementally.

| column | type | notes |
|---|---|---|
| `user_id` | text FK | |
| `date` | text | `YYYY-MM-DD` |
| `recovery` | real null | 0–100, gated behind HRV availability |
| `recovery_components` | text (JSON) | `{hrvZ, rhrZ, brZ, sleepZ}` for transparency |
| `strain` | real null | 0–21, self-calibrated to user's 90-day TRIMP distribution |
| `trimp` | real null | raw Banister TRIMP before log-map |
| `hrv_rmssd` | real null | nightly RMSSD (ms) |
| `hrv_ln_ewma` | real null | EWMA of ln(RMSSD) — the rolling baseline |
| `hrv_band_low` / `hrv_band_high` | real null | baseline ± 0.75σ; the "target" band |
| `resting_hr` | int null | |
| `breathing_rate` | real null | |
| `spo2` | real null | |
| `skin_temp_dev` | real null | deviation from baseline |
| `sleep_asleep_min` / `sleep_in_bed_min` | int null | |
| `sleep_efficiency` | int null | |
| `sleep_stages` | text (JSON) | `{deep,light,rem,wake}` |
| `sleep_need_min` | int null | dynamic need = baseline + debt + strain adj |
| `sleep_need_breakdown` | text (JSON) | itemized; α(debt)/β(strain) coefficients shown |
| `sleep_performance` | real null | asleep ÷ need, 0–100 |
| `sleep_debt_min` | int null | decaying 5-night accumulator (decay≈0.5) |
| `calories_out` | int null | |
| `vo2max` | real null | provider Cardio Fitness Score |
| `fitness_age` | real null | VO2max-vs-norms (HUNT); cardiorespiratory only |
| `stress_estimate` | real null | HR-arousal derived; label "HR-based estimate" |
| `computed_at` | int | when the derivation job last wrote this row |

PK `(user_id, date)`. Nullable everywhere because signals arrive at different
times of day and some (HRV) gate downstream scores. The `*_ewma` / `*_band`
columns let the nightly job compute incrementally instead of rescanning history.

### 2.6 `exercise_sessions` (per-workout detail w/ HR)
Provider-detected and manual workouts, with HR summary, for the per-exercise view.

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `user_id` | text FK | |
| `provider` | text | |
| `external_id` | text | provider log id |
| `log_type` | text | `auto_detected` (SmartTrack) \| `manual` \| `pushed` |
| `activity` | text | walk/run/etc. |
| `start_at` | int | epoch ms |
| `duration_sec` | int | |
| `distance_m` | real null | |
| `calories` | int null | |
| `avg_hr` / `max_hr` | int null | |
| `hr_zones` | text (JSON) | `HeartRateZone[]` |

Unique on `(user_id, provider, external_id)`.

### 2.7 `pushed_activities` (push-walk dedupe ledger)
Replaces the `fitbit_logged` cookie array. Durable, queryable, no 500-id cap.

| column | type | notes |
|---|---|---|
| `user_id` | text FK | |
| `source_id` | text | the KS Fit session id (`ActivityLogInput.sourceId`) |
| `provider` | text | |
| `external_id` | text null | provider's id for the created log |
| `pushed_at` | int | |

PK `(user_id, provider, source_id)`. `isLogged(sourceId)` becomes a row existence
check; the push route inserts on success.

### 2.8 `coach_conversations` + `coach_messages` (AI memory)
| `coach_conversations` | type | |
|---|---|---|
| `id` | text PK | |
| `user_id` | text FK | |
| `title` | text null | |
| `created_at` / `updated_at` | int | |

| `coach_messages` | type | |
|---|---|---|
| `id` | text PK | |
| `conversation_id` | text FK | |
| `role` | text | `user` \| `assistant` \| `tool` |
| `content` | text (JSON) | `ModelMessage` parts (so message-level prompt caching works) |
| `created_at` | int | |
| `token_usage` | text (JSON) null | for cost tracking |

Numbers in assistant messages are sourced only from tool results (§4); content
stores the tool-call/result parts so citations are auditable.

### 2.9 `push_subscriptions`
| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `user_id` | text FK | |
| `transport` | text | `web_push` (VAPID) now \| `apns` (iOS, Phase 5) |
| `endpoint` | text | Web Push URL / APNs device token |
| `keys` | text (JSON) null | `{p256dh, auth}` for Web Push |
| `created_at` | int | |

Cron (weekly weight reminder) reads this table when `getWeightTrend` shows a
stale reading and sends to every active subscription for the user.

---

## 3. Shared TypeScript types

These live in `packages/shared-types` as **Zod schemas** that emit both the
OpenAPI spec and the generated TS/Swift clients. They **mirror today's
`web/src/lib/health/types.ts`** verbatim (so the migration is a move, not a
rewrite) and **extend** it with the missing signals + derived scores.

### 3.1 Carried over unchanged (provider layer)
`HeartRatePoint`, `HeartRateZone`, `DayHeartRate`, `SleepSummary`,
`DailyActivity`, `WeightReading`, `ActivityLogInput`, `ActivityLogResult`,
`NotConnectedError` — exactly as defined today.

### 3.2 `HealthProvider` extended (prerequisite #1)
The interface gains the signals that gate WHOOP-style metrics. Both Fitbit (today)
and `GoogleHealthProvider` implement the same surface.

```ts
export interface HrvReading {
  date: string;        // YYYY-MM-DD (wake date)
  rmssd: number;       // ms, nightly
}
export interface BreathingReading { date: string; breathsPerMin: number; }
export interface Spo2Reading { date: string; avgPct: number; minPct?: number; }
export interface SkinTempReading { date: string; deviationC: number; } // vs baseline
export interface CardioScore {
  date: string;
  vo2max: number;      // Fitbit Cardio Fitness Score / Google equivalent
  range?: { low: number; high: number };
}

export interface HealthProvider {
  readonly name: string;
  isConnected(): Promise<boolean>;

  // existing
  getHeartRateForDay(date: string, withIntraday: boolean): Promise<DayHeartRate>;
  getSleep(date: string): Promise<SleepSummary | null>;
  getDailyActivity(date: string): Promise<DailyActivity | null>;
  getWeightLog(fromDate: string, toDate: string): Promise<WeightReading[]>;
  logActivity(input: ActivityLogInput): Promise<ActivityLogResult>;

  // new (Fitbit-available now, on Google roadmap)
  getHrv(date: string): Promise<HrvReading | null>;
  getBreathingRate(date: string): Promise<BreathingReading | null>;
  getSpo2(date: string): Promise<Spo2Reading | null>;
  getSkinTemp(date: string): Promise<SkinTempReading | null>;
  getCardioScore(date: string): Promise<CardioScore | null>;
}
```

### 3.3 Derived (WHOOP-style) types — the backend's own output
Not provider types; computed by the pipeline in §4. Every value carries provenance
so the coach can cite it.

```ts
export interface MetricValue {
  value: number;
  unit: string;
  asOf: string;                          // YYYY-MM-DD
  source: "device" | "derived" | "estimate";
}

export interface RecoveryScore {
  date: string;
  score: number | null;                  // 0-100, null when HRV unavailable
  available: boolean;                     // gate flag
  components: { hrvZ: number; rhrZ: number; brZ: number; sleepZ: number };
  weights: { hrv: number; rhr: number; br: number; sleep: number }; // ours, shown
  label: "Recovery (Stride estimate)";
}

export interface StrainScore {
  date: string;
  strain: number;                        // 0-21
  trimp: number;
  calibration: { p90Window: number };    // self-calibrated to user's 90d distn
}

export interface HrvStatus {
  date: string;
  rmssd: number | null;
  baselineLn: number | null;             // EWMA of ln(RMSSD), 30 nights
  band: { low: number; high: number } | null; // baseline ± 0.75σ = the target
  trend: "rising" | "flat" | "falling";
}

export interface SleepAnalysis {
  date: string;
  asleepMin: number;
  needMin: number;
  needBreakdown: { baseline: number; debt: number; strainAdj: number };
  performance: number;                   // 0-100
  debtMin: number;                       // decaying 5-night accumulator
  stages?: { deep: number; light: number; rem: number; wake: number };
}

export interface FitnessAge {
  date: string;
  vo2max: number | null;
  fitnessAge: number | null;
  label: "Fitness Age (cardiorespiratory)";
  method: "vo2max_norms" | "non_exercise_regression";
}

export interface StressEstimate {
  date: string;
  value: number;                         // HR-arousal derived
  label: "Stress (HR-based estimate)";   // never "Stress Score"
}

export interface DailySnapshot {        // the coach's cache-marked context blob
  date: string;
  recovery: RecoveryScore;
  strain: StrainScore;
  hrv: HrvStatus;
  sleep: SleepAnalysis;
  fitnessAge: FitnessAge;
  stress: StressEstimate;
  restingHr: MetricValue | null;
  caloriesOut: MetricValue | null;
  weight: MetricValue | null;
}
```

The `label` literals encode the plan's honesty rules: estimates are named as
estimates, never claimed as WHOOP/EDA parity.

---

## 4. Metric-computation pipeline

Raw provider data → normalized cache → nightly derivation → `daily_scores` →
REST resources → dashboards + coach tools. **All numbers are computed
deterministically in the backend; the AI model only interprets and cites them.**

```
                 ┌─────────────────────────────────────────────────────────┐
                 │  Provider (Fitbit now / GoogleHealth later)               │
                 │  HR(+intraday), sleep, activity, weight, HRV, breathing, │
                 │  SpO2, skin temp, cardio score   ── HealthProvider iface  │
                 └───────────────┬─────────────────────────────────────────┘
                                 │  fetchers (fail-soft, TTL cache)
                                 ▼
                 ┌─────────────────────────────────────────┐
                 │  cached_metrics (day-grained) + TTL Map   │  raw layer
                 │  intraday HR: in-memory cache only         │
                 └───────────────┬───────────────────────────┘
                                 │  nightly derivation job (cron) + profile
                                 ▼
                 ┌─────────────────────────────────────────┐
                 │  metric engine (packages/health-core)     │  pure functions
                 │  baselines (EWMA), z-scores, TRIMP, debt   │  → testable
                 └───────────────┬───────────────────────────┘
                                 │  upsert
                                 ▼
                 ┌─────────────────────────────────────────┐
                 │  daily_scores  (system of record)         │  derived layer
                 └───────────────┬───────────────────────────┘
                                 │
              ┌──────────────────┼─────────────────────────────┐
              ▼                  ▼                             ▼
        REST resources     dashboards (apps/web)        coach tools
        (OpenAPI)          + iOS                         {value,unit,asOf,source}
```

### 4.1 Stages

1. **Ingest (fail-soft).** Existing `fetchers.ts` pattern: each call returns the
   "feature off" shape (null/empty) when the provider is disconnected or errors;
   pages render conditionally. Day-grained results land in `cached_metrics`;
   intraday HR stays in the TTL `Map` only.

2. **Normalize.** Provider responses → the shared types in §3.1/§3.2. This is the
   only provider-specific code; the migration **Parity Tool** field-maps each
   Fitbit call to its Google equivalent here. (Risk: Google `Heart Rate` is Sample
   granularity — validate sample density vs the HR overlay before cutover.)

3. **Derive (nightly cron, pure functions in `health-core`):**
   - **HRV baseline/band:** `hrv_ln_ewma` = EWMA of ln(RMSSD) over 30 nights;
     band = baseline ± 0.75σ. The band *is* the target — no fabricated absolute
     ideal. Trend (rising/flat/falling) is the real signal.
   - **Recovery (gated on HRV):** z-score each of HRV, resting HR (inverted),
     breathing rate (inverted), sleep performance against the personal EWMA
     baseline; weighted sum w_hrv 0.50 / w_rhr 0.25 / w_br 0.10 / w_sleep 0.15 →
     0–100. `available=false` (score null) when no HRV — the feature is hidden,
     not faked.
   - **Strain:** HRR-weighted Banister **TRIMP** from intraday HR + resting HR +
     age-derived HRmax (or `hr_max_override`); log-map to 0–21 **self-calibrated**
     to the user's own 90-day TRIMP distribution. Comparable day-over-day for the
     user, not against anyone else's device.
   - **Sleep:** need = baseline + α·debt + β·strainAdj (α, β ours, shown in
     breakdown); performance = asleep ÷ need; debt = decaying 5-night accumulator
     (decay ≈ 0.5).
   - **Fitness Age:** device VO2max → age/sex norm tables (HUNT method). Non-exercise
     regression only as fallback. **HUNT (Nes 2011) coefficients must be verified
     against the primary paper before hardcoding** — flagged unverified.
     Cardiorespiratory only; never biological/epigenetic age.
   - **Stress estimate:** intraday HR elevation vs resting, exercise excluded.
     Self-derived (neither API exposes EDA/Stress Score); labeled "HR-based
     estimate"; the most fabrication-prone metric — claims kept modest.

4. **Persist.** Upsert one `daily_scores` row per (user, date), including the
   `*_ewma`/`*_band` baseline state so the next night computes incrementally.

5. **Serve.** REST resources (OpenAPI) for web + iOS. Coach tools wrap the same
   accessors and return `{value, unit, asOf, source}`; a cache-marked
   `DailySnapshot` is prepended to the prompt. The model interprets and cites —
   it never calculates or invents a health value, runs a bounded loop
   (`stepCountIs(6)`), and carries the mandatory medical disclaimer.

### 4.2 Hard gates (enforced in the engine, surfaced in types)
- No HRV → Recovery `available=false`, score null. Show simpler metrics meanwhile.
- Estimates labeled as estimates (`source: "estimate"`, explicit `label` literals).
- Coach numbers only from tool results / snapshot; per-user tool scoping — never
  trust a client-supplied user id.

---

## 5. Migration touchpoints (today → this model)

| Today | Becomes |
|---|---|
| `fitbit_tokens` cookie (`tokens.ts`) | `provider_accounts` (encrypted), cron refresh |
| `ksfit_session` cookie (`session.ts`) | `app_sessions` (hashed opaque token, cookie+bearer) |
| `fitbit_logged` cookie array (`logged.ts`) | `pushed_activities` rows |
| in-process TTL `Map` (`cache.ts`) | stays as hot read layer; `cached_metrics` adds durability for day-grained reads |
| settings cookies (`settings/*`) | schema → `shared-types`; persistence → DB user/profile + a small settings table |
| (none) | `daily_scores`, `exercise_sessions`, `coach_*`, `push_subscriptions` (all new) |

The `HealthProvider` interface itself only **gains methods** (§3.2); no existing
signature changes, so today's Fitbit provider keeps working unmodified through the
migration.
