# Implementation Notes — Integration Checklist

**Status:** integration handoff. **Date:** 2026-05-29.
**Audience:** the human wiring together the output of the Build agents.

This is the one-stop checklist for assembling what the Build agents produced into
a running system. It assumes you have read the authoritative docs
([03-DATA-MODEL](./03-DATA-MODEL.md), [04-FEATURES](./04-FEATURES.md),
[05-AI-COACH](./05-AI-COACH.md)) — this file only records *what was built*, *what
is still missing*, and *the exact wiring steps* between them.

The Build agents worked under hard isolation: each owned one directory, created
only new files there, and did **not** touch shared barrels, other packages, or
run any installer. Consequently several integration seams are deliberately left
open for you below.

---

## 1. What each Build agent produced

### 1.1 `signals` — provider seam extension (`packages/health-core`)
Extended the `HealthProvider` interface and Fitbit provider with the WHOOP-gating
signals.

- `src/types.ts` — extended in place (existing members untouched). New domain
  types: `HrvReading`, `BreathingReading`, `Spo2Reading`, `SkinTempReading`
  (`relativeC` = nightly deviation from baseline), `CardioScore` (range-aware,
  midpoint→`vo2max`), `Exercise` (`source: 'auto' | 'manual'`), `UserProfile`.
- `src/fitbit/provider.ts` — implemented the seven new methods plus a fail-soft
  `callSoft<T>` helper (rethrows `NotConnectedError` + `FitbitRateLimitError`,
  swallows 404/malformed → returns `null`/`[]`).
- `src/fitbit/normalize.ts` — NEW; pure, network-free, unit-testable parsing.
- `oauth.ts`: no change.

New `HealthProvider` methods (existing five kept verbatim): `getHrv`,
`getBreathingRate`, `getSpo2`, `getSkinTemp`, `getCardioScore`, `getExercises`,
`getProfile`.

Integration notes:
- `getExercises(date)` uses `activities/list.json?afterDate=...` and filters to
  the day; `logType === "auto_detected"` → `source: 'auto'`.
- `getProfile()` maps Fitbit gender → `male|female|unspecified`; height/weight
  come back metric (via the existing `Accept-Language: en_US`). **`waistCm` is
  NOT exposed by Fitbit** — it must be captured via the app's own profile UI/DB
  (`users.waist_cm`, a user-entered column per DATA-MODEL §2.1) and is the
  non-exercise VO2max fallback input.
- Auto-exported: the barrel uses `export * from "./types"`, so all new types
  flow through with **no barrel edit needed for types**.

### 1.2 `metrics` — derivation engine (`packages/health-core/src/metrics`)
Pure, deterministic, unit-tested metric functions. **All seven dashboards' math
lives here.**

- `baseline.ts` — `spanToLambda`, `clamp`, `standardNormalCdf` (Φ via A&S erf),
  `ewma` (mean + EWMA-variance, optional `ln`), `zScore` (clamped [−3,3]),
  `percentile`.
- `hrv.ts` — `computeHrvBaseline` (ln-space EWMA span 30, band `exp(μ ± 0.75σ)`);
  exports `HRV_MIN_NIGHTS = 14` (the recovery gate threshold).
- `recovery.ts` — `computeRecovery` (weights HRV .50 / RHR .25 / BR .10 /
  sleep .15; `recovery = round(100·Φ(S))`). **HRV gate**: returns `score: null`
  with `gatedReason: 'no-hrv-history' | 'insufficient-hrv-history' |
  'no-hrv-tonight'`, still emitting oriented components for the UI.
- `strain.ts` — `computeStrain`, `computeTrimp`, `hrMaxFromAge` (Tanaka),
  `resolveHrMax` (override → age → null). Banister TRIMP → `ln(1+TRIMP)` →
  `21·clamp(L/L_p95,0,1)`, self-calibrated to the user's 90-day distribution;
  fixed fallback `ln(1+300)` + `calibrating` flag under 14 days.
- `sleep.ts` — `computeBaselineNeed`, `computeSleepNeed`,
  `computeSleepPerformance` (capped 100), `computeSleepDebt` (decaying 5-night,
  decay 0.5), `sleepRecommendations` (deterministic), `STAGE_NORMAL_PCT`.
- `stress.ts` — `computeStress` (label literal `"Stress (HR-based estimate)"`,
  exercise/sleep windows excluded, personal terciles w/ fixed-cut fallback under
  30 days), `exerciseWindows(exercises)`.
- `fitnessAge.ts` — `computeFitnessAge`, `ageForVo2max`, `MEDIAN_VO2MAX_NORMS`.
  Device-VO2max → norm-inversion (`confidence: 'moderate'`). **Non-exercise
  (Nes 2011 / HUNT) fallback is intentionally BLOCKED** — returns null + reason,
  with a `TODO(HUNT/Nes-2011)` on the interim norm table. Verify coefficients
  against the primary paper before unblocking (DATA-MODEL §4.3, FEATURES §6).
- `index.ts` — barrel for the **metrics subdir only**. The package top-level
  `src/index.ts` was NOT touched (see §3.1 below — you must wire it).
- `__tests__/*` — one Vitest file per metric; load-bearing arithmetic
  independently re-derived.
- `package.json` — added `"test": "vitest run"` + `vitest ^3.0.5` devDep
  (the package's own manifest, allowed).

Integration notes:
- `resolveHrMax` takes a `hrMaxOverride` field (maps to `users.hr_max_override`)
  that is NOT on `UserProfile` — the caller passes it alongside the profile.
- `computeRecovery` consumes `sleepPerformance` (from
  `computeSleepPerformance`) + HRV/RHR/breathing history series. Wire these from
  the nightly job per the DATA-MODEL §4 pipeline.

### 1.3 `db` — persistence layer (`packages/db`, `@stride/db`)
Self-contained Drizzle + better-sqlite3 layer, schema per DATA-MODEL §2
(authoritative table names).

- `package.json`, `tsconfig.json`, `drizzle.config.ts`, `README.md`.
- `src/schema.ts` — full Drizzle SQLite schema (Postgres-portable).
- `src/bootstrap.ts` — `BOOTSTRAP_DDL` raw idempotent `CREATE TABLE IF NOT
  EXISTS` string, verified column-for-column against `schema.ts`.
- `src/client.ts` — `getDb()`, `closeDb()`.
- `src/repos/{tokens,sessions,metrics,coach,push,dedupe}.ts` + `index.ts`.
- `src/index.ts` — barrel.

Tables (per the doc, which overrode the brief's older names): `users`,
`provider_accounts`, `app_sessions`, `cached_metrics`, `daily_scores`,
`exercise_sessions`, `pushed_activities`, `coach_conversations`,
`coach_messages`, `push_subscriptions`. App-generated text PKs; epoch-ms int
timestamps; JSON as text; encrypted tokens as blob.

Key exports / behaviour:
- `getDb(dbPath?)` opens at `STRIDE_DB_PATH ?? "./stride.db"`, WAL +
  foreign_keys on, runs idempotent bootstrap, memoizes one connection per path.
  Also exports `closeDb()`, `BOOTSTRAP_DDL`, `schema`.
- `tokensRepo` — `.upsert/.get/.exists/.remove`; AES-256-GCM via `node:crypto`
  with `TOKEN_ENC_KEY` (fresh IV per field, no nonce reuse). **Requires
  `TOKEN_ENC_KEY` at runtime.**
- `sessionsRepo` — `.mint/.validate/.revoke/.revokeAllForUser`; stores only
  SHA-256 hash; exports `hashToken()`.
- `metricsRepo` — `.upsertDaily/.getDaily/.getDailyRange` (`daily_scores`) +
  `.putCached/.getCached` (`cached_metrics`, TTL).
- `coachRepo` — `.createConversation/.listConversations/.addMessage/
  .loadMessages` (ModelMessage parts as JSON, user-scoped, sliding window).
- `pushRepo` — `.subscribe/.listActive/.revoke`.
- `dedupeRepo` — `.isLogged/.record/.listSourceIds` (idempotent).

Integration note: the agent could not typecheck (deps uninstalled, installers
forbidden). After install, run `pnpm --filter @stride/db typecheck`.

### 1.4 `schemas` — API contract (`packages/shared-types/src/schemas`)
Zod schemas + inferred types for every REST endpoint, aligned to the API
contract field names/units. `tsc --noEmit` exit 0.

- `metrics.ts` — primitives (`DateString`, `EpochMs`, `MetricSource`,
  `MetricValue`/`NullableMetricValue`, `Trend`, `DateQuery`, `RangeQuery`) +
  responses: `RecoveryResponse`, `StrainResponse`, `SleepResponse`,
  `HrvResponse`, `StressResponse`, `FitnessAgeResponse`,
  `DailyActivityResponse`/`DailyActivitySeriesResponse`.
- `exercises.ts` — `ExerciseListItem`, `ExerciseDetail` (+ `hr` series),
  `ExerciseListQuery`, `ExerciseListResponse`, `ExerciseDetailResponse`.
  (Surfaces `distanceKm` + `autoDetected`, `startTime` as epoch-ms.)
- `profile.ts` — `Sex`, `ProfileResponse`, `ProfileUpdateRequest` (PATCH).
- `coach.ts` — `CoachMessage`, `CoachChatRequest` (`{conversationId?,
  messages[]}`), SSE event union `CoachStreamEvent`
  (`text-delta`/`tool-call`/`tool-result`/`data-disclaimer`/`error`/`done`),
  `CoachChatJsonResponse`, conversation-memory shapes. Imports `ErrorCode` from
  `../errors` for the stream `error` event.
- `push.ts` — `VapidKeyResponse`, `PushSubscriptionRegisterRequest`
  (discriminated `web|apns`), register/delete shapes, weekly-weight-reminder
  config (`Weekday`, `WeeklyWeightReminderConfig`, …).
- `index.ts` — barrel for the **schemas subdir only**. The package top-level
  `src/index.ts` (currently `export * from "./errors"`) was NOT touched (see
  §3.2 below).

Alignment decisions: exact `label` literals ("Recovery (Stride estimate)",
"Stress (HR-based estimate)", "Fitness Age (cardiorespiratory)"); method literals
(`banister_trimp_hrr`, `ewma_ln_rmssd_30d`,
`hr_arousal_vs_resting_exercise_excluded`); `MetricSource` accepts both provider
names (`fitbit`/`google`/`ksfit`) and the coarse `device`/`derived`/`estimate`.

### 1.5 `coach` — AI coach module (`apps/backend/src/lib/coach`)
The interpretive layer per 05-AI-COACH. Typechecked clean (modeled on real
`ai`/`@ai-sdk/anthropic` v6 type shapes; deps not installable).

- `model.ts` — `createAnthropic` (reads `ANTHROPIC_API_KEY`, throws if missing);
  pinned bare model ids `COACH_MODEL_IDS = { chat: "claude-sonnet-4-6", briefing:
  "claude-haiku-4-5" }`; `coachModel(kind)`, `createCoachProvider(apiKey?)`,
  `COACH_PROVIDER_OPTIONS` (`thinking: { type: 'adaptive' }`),
  `COACH_MAX_OUTPUT_TOKENS = 1500`, `COACH_MAX_STEPS = 6`.
- `systemPrompt.ts` — frozen `COACH_SYSTEM_PROMPT` (no dates/user-id/metrics, so
  the cached prefix stays byte-stable). The mandatory disclaimer is deliberately
  NOT here (appended verbatim by `safety.ts`, which you build).
- `tools.ts` — `CoachDataSource` interface (no user-id params; route-scoped) +
  `buildCoachTools(ds): ToolSet` with 8 tools: `getRecovery`, `getStrain`,
  `getSleep`, `getHrvTrend`, `getStress`, `getFitnessAge`, `getDailyActivity`,
  `getExercises`. Grounding envelope `Grounded<T> = { value, unit, asOf,
  source }`, fail-soft `ToolResult<T>` (`{available:false, reason}`), helpers
  `grounded()`/`unavailable()`.
- `context.ts` — `buildSnapshotText(s)`, `buildSnapshotMessage(s)`
  (cache-marked `ModelMessage`, `cacheControl: { type: 'ephemeral' }`).
- `chat.ts` — `streamCoach({ messages, dataSource, snapshot?, kind?,
  abortSignal?, onFinish? })`; `convertToModelMessages`, injects cache-marked
  snapshot ahead of history, `streamText` w/ `stopWhen: stepCountIs(6)`.
- `index.ts` — barrel re-exporting the public surface.

**NOT built (other owners / your wiring):** `routes/coach.ts`, `safety.ts`
(disclaimer + symptom precheck), `memory.ts`, and the real `CoachDataSource`
implementation over `packages/health-core` metrics + `@stride/db`.

---

## 2. DEPS NEEDED (consolidated, deduped, with versions)

Run **one** `pnpm install` after applying all of the below. Nothing is installed
yet anywhere in the repo.

### `packages/db` (NEW package — already declared in its own `package.json`)
- dependencies: `drizzle-orm@^0.45.2`, `better-sqlite3@^12.10.0`
- devDependencies: `drizzle-kit@^0.31.10`, `@types/better-sqlite3@^7.6.13`,
  `@types/node@^22.10.5`, `typescript@^5.7.3`

### `packages/health-core` (already declared in its own `package.json`)
- devDependencies: `vitest@^3.0.5`

### `apps/backend` (you must ADD these — the agent could not edit the manifest)
- dependencies:
  - `ai@^6.0.193`
  - `@ai-sdk/anthropic@^3.0.81`
  - `zod@^3.25.76`  *(pin to the workspace's existing 3.25.76; `ai@6` peer is
    `^3.25.76 || ^4.1.8` — do not introduce a second zod major)*
  - `@stride/db@workspace:*`  *(coach `CoachDataSource` impl + memory will need
    it; backend has no db dep yet)*

### `packages/shared-types`
- none — `zod@^3.24.1` (resolved 3.25.76) already present.

---

## 3. Barrels / manifests YOU must update

The Build agents could not edit shared barrels they didn't own. These are the
exact edits required.

### 3.1 `packages/health-core/src/index.ts` — export the metrics engine
Currently ends at the Fitbit provider re-export. The `metrics/` subdir barrel
exists but is **not** re-exported from the package entry point. Add:

```ts
export * from "./metrics";
```

(The new `types.ts` members already flow through the existing
`export * from "./types"`, so no change is needed for the signals types.)

### 3.2 `packages/shared-types/src/index.ts` — export the API schemas
Currently only `export * from "./errors"`. The `schemas/` subdir barrel exists
but is not re-exported. Add:

```ts
export * from "./schemas";
```

### 3.3 `apps/backend/package.json` — add the coach + db deps
Add the dependencies listed in §2 above. The backend manifest was untouched by
the coach agent.

### 3.4 (no edit) `packages/db` schema/bootstrap
Self-contained; the barrel is internal. Just verify after install:
`pnpm --filter @stride/db typecheck`.

---

## 4. Backend routes still to add (`apps/backend/src/routes/*`)

None of these exist yet; the schemas (§1.4) and metric/db/coach building blocks
do. Each route resolves `userId` from the auth middleware (DATA-MODEL §2.3,
AI-COACH §3) and reads `daily_scores` snapshots via `metricsRepo`.

- `GET /v1/metrics/recovery` → `RecoveryResponse`
- `GET /v1/metrics/strain` → `StrainResponse`
- `GET /v1/metrics/sleep` → `SleepResponse`
- `GET /v1/metrics/hrv` → `HrvResponse` (range/trend)
- `GET /v1/metrics/stress` → `StressResponse`
- `GET /v1/metrics/fitness-age` → `FitnessAgeResponse`
- `GET /v1/metrics/activity` → `DailyActivityResponse` / series
- `GET /v1/exercises` → `ExerciseListResponse`
- `GET /v1/exercises/:id` → `ExerciseDetailResponse` (with HR overlay series)
- `GET /v1/profile`, `PATCH /v1/profile` → `ProfileResponse` /
  `ProfileUpdateRequest` (capture `waistCm` / `hr_max_override` here — Fitbit
  does not supply them)
- `POST /v1/coach/chat` → streaming SSE; build the real `CoachDataSource`
  (scoped to `userId`), call `streamCoach`, return
  `.toUIMessageStreamResponse()`. Also `POST /v1/coach/briefing` (cron, haiku).
  Requires `safety.ts` (symptom precheck + disclaimer) and `memory.ts`
  (load/save against `coachRepo`).
- `POST /v1/push/subscriptions`, `DELETE /v1/push/subscriptions/:id`,
  `GET /v1/push/vapid-key` → push schemas; `pushRepo`.

Cross-cutting still to build: auth middleware + `POST /auth/session` (mints the
opaque token via `sessionsRepo.mint`), the nightly **derivation cron** (wires
provider fetchers → metrics engine → `metricsRepo.upsertDaily`), and the
**token-refresh cron** (reads `provider_accounts` near `expires_at`).

---

## 5. Frontend dashboards still to build (`apps/web` — untouched by all agents)

Each consumes a `/v1/metrics/*` (or exercises/coach) response above. Honest-label
literals and component breakdowns are already in the schemas.

- **Recovery** — colored ring + number, label "Recovery (Stride estimate)",
  expandable 4-component diverging bars (HRV/RHR/Breathing/Sleep z), 7/30-day
  sparkline, "Ask the coach why" hook. Hide when gated (`score: null`).
- **Strain** — 0–21 gauge + "vs 30-day avg" delta, zone-minutes stacked bar,
  Strain-vs-Recovery weekly scatter, coverage indicator, "calibrating" tag.
- **Sleep** — hypnogram stage timeline, Sleep Performance ring, itemized Need
  breakdown (baseline + debt + strain − nap), 5-night sleep-debt gauge,
  deterministic "Tonight" recommendation banner.
- **HRV** — 30-night RMSSD line over shaded ±0.75σ band + baseline center line,
  today's point green-inside/amber-outside, trend chips ("Baseline ↑ 4ms").
- **Stress** — daytime ribbon colored low→high with exercise periods hatched
  "excluded", day index + bucket, "HR-based estimate" caption.
- **Fitness Age** — "Fitness age: X (you are Y)" headline + delta chip,
  VO2max-vs-norms curve. Non-exercise fallback stays hidden until HUNT verified.
- **Exercise detail** — session list w/ SmartTrack badge; detail view w/ HR-curve
  overlay (reuse existing treadmill overlay), zone-minutes bar, avg/peak HR,
  per-session TRIMP, calories.
- **Weekly weight reminder** — PWA service worker (`public/sw.js`) +
  `manifest.webmanifest`, push subscribe flow → `POST /v1/push/subscriptions`,
  in-app banner fallback, settings (reminder day / opt-out / device mgmt).

---

## 6. Environment variables

| Var | Used by | Notes |
|---|---|---|
| `TOKEN_ENC_KEY` | `@stride/db` `tokensRepo` | 32-byte AES-256-GCM key as 64 hex chars or base64. Required at runtime for token custody. |
| `STRIDE_DB_PATH` | `@stride/db` `getDb()` | SQLite file path; defaults to `./stride.db`. Point at the mounted Docker volume. |
| `ANTHROPIC_API_KEY` | coach `model.ts` | `createAnthropic` throws clearly if absent. |
| `APP_ORIGIN` | backend (CORS / cookie domain / push deep-links) | the web origin (e.g. `https://treadmill.home`); needed for secure-context Web Push (FEATURES §12 LAN/HTTPS caveat). |

Also expected by push send (FEATURES §12, not yet wired): `VAPID_PUBLIC_KEY` /
`VAPID_PRIVATE_KEY` when the Web Push sender is built.

---

## 7. Remaining work — phase by phase

**Phase 2 — persistence + provider seam (foundations the rest builds on)**
1. `pnpm install` once (all §2 deps).
2. Edit the two barrels (§3.1, §3.2) and add backend deps (§3.3).
3. `pnpm -r typecheck` — expect `@stride/db` + health-core metrics to go green
   only after install; fix any drizzle/better-sqlite3 API drift surfaced.
4. Set `TOKEN_ENC_KEY` + `STRIDE_DB_PATH`; smoke-test `getDb()` bootstrap on the
   mounted volume.
5. Auth: build the middleware + `POST /auth/session` over `sessionsRepo`.
6. Migrate the existing cookie custody (tokens/session/dedupe) onto
   `provider_accounts` / `app_sessions` / `pushed_activities` (DATA-MODEL §5).

**Phase 3 — derived metrics + REST + coach**
7. Nightly **derivation cron**: provider fetchers → `metrics/*` engine →
   `metricsRepo.upsertDaily` (carry the `*_ewma`/`*_band` baseline state).
8. **Token-refresh cron** over `provider_accounts`.
9. Build the `/v1/metrics/*`, `/v1/exercises/*`, `/v1/profile` routes (§4).
10. Build `/v1/push/*` routes + the VAPID Web Push sender + weekly-weight cron
    (idempotent by `(userId, type, isoWeek)`).
11. Coach: build `safety.ts`, `memory.ts`, the real `CoachDataSource`, and
    `routes/coach.ts` (`/v1/coach/chat` + `/v1/coach/briefing`). Verify prompt
    caching: `cache_read_input_tokens > 0` on turn 2.
12. Frontend dashboards (§5) + PWA push (service worker + manifest); confirm the
    LAN cert is accepted for service-worker registration (FEATURES §12).

**Phase 4 — provider migration (Google Health)**
13. Implement `GoogleHealthProvider` against the unchanged `HealthProvider`
    seam; field-map each Fitbit call in a normalize layer. Validate Google
    `Heart Rate` Sample density is sufficient for the HR overlay before cutover.

**Phase 5 — iOS**
14. APNs sender branch + iOS client registration to the existing
    `POST /v1/push/subscriptions`; Bearer transport on `app_sessions`. No new
    backend contract (the coach stream + REST are already transport-neutral).

**Cross-cutting verification gates (do not ship without):**
- HRV gate honored end-to-end (recovery hidden, not faked) — DATA-MODEL §4.2.
- Fitness-age non-exercise fallback stays **blocked** until HUNT/Nes-2011
  coefficients are verified from the primary paper — FEATURES §6.
- Coach states no number absent a tool/snapshot citation; symptom escalation
  short-circuits before the model; disclaimer appended verbatim — AI-COACH §8.

---

*This file is the integration map only. The metric math, schema fields, and
table shapes are defined by the authoritative docs cross-referenced throughout.*
