# Stride — Backend API Contract (v1)

The single contract consumed by **`apps/web`** (Next.js server components + a thin
client) and the **future `apps/ios`** native app. The backend (`apps/backend`,
Hono) is the sole custodian of third-party OAuth tokens; clients only ever hold an
opaque Stride session token. Every shape below is defined as a Zod schema in
`packages/shared-types` and emitted as an OpenAPI 3.1 document at
`GET /openapi.json`, from which the TS client (web) and the Swift client (iOS) are
generated. **This file is the human-readable mirror of that spec — when they
disagree, the Zod schemas win.**

> Status: design contract for Phases 1–4 of the synthesized plan. Phase 1 ships a
> subset (auth + the endpoints that wrap today's working routes); the WHOOP-style
> metrics, coach, and Google provider land in later phases. Endpoints not yet
> implemented in a given phase return `501 not_implemented` so the shape is stable
> from day one.

---

## 0. Conventions

- **Base URL:** `/api` (Caddy on `treadmill.home` routes `/api` → backend, `/` → web). All paths below are relative to `/api`.
- **Versioning:** URL-prefixed major version, `/api/v1/...`. The version is part of the path so web and iOS can pin independently and a breaking v2 can run side-by-side. Additive, backward-compatible changes (new optional fields, new endpoints) ship under v1; only breaking changes bump to v2. Each response carries `X-Stride-API: 1` and a `Deprecation` / `Sunset` header pair once a version is scheduled for removal.
- **Transport:** JSON over HTTPS. `Content-Type: application/json` on request bodies. UTF-8.
- **Auth transport, one validation path:** the backend validates the **same opaque 256-bit session token** whether it arrives as
  - web: `Cookie: stride_session=<token>` (httpOnly, `Secure`, `SameSite=Lax`), or
  - iOS: `Authorization: Bearer <token>` (token stored in Keychain).
  The token is stored only as a SHA-256 hash in `sessions` (Phase 2). Cookie path is preferred for web (CSRF-safer with `SameSite`); Bearer for native.
- **CSRF:** state-changing cookie-authenticated requests require `X-Stride-CSRF` matching the double-submit token issued at login. Bearer requests are exempt (no ambient credentials).
- **Dates & units:** dates are `YYYY-MM-DD` (local wake-date for sleep). Instants are **Unix epoch milliseconds, UTC** (`t`), matching today's `HeartRatePoint.t`. Distance metres, duration seconds, mass kilograms, energy kcal — unit-free at the edge, mirroring `packages/health-core` normalizers. Derived metrics also carry an explicit `unit` string.
- **Pagination:** list endpoints accept `?limit=` (default 50, max 200) and `?cursor=` (opaque). Responses return `{ items, nextCursor | null }`.
- **Idempotency:** unsafe POSTs that create external state (e.g. activity push) accept `Idempotency-Key`; the backend dedupes via the push-walk ledger (Phase 2).
- **Caching:** read endpoints set `Cache-Control` + `ETag`; the backend's in-memory TTL cache (ported from `web/src/lib/cache.ts`) sits behind them.

### Error model

Every non-2xx response is the same envelope (RFC 9457-flavored):

```jsonc
{
  "error": {
    "code": "not_connected",        // stable machine string (snake_case)
    "message": "Fitbit is not connected.", // human, safe to display
    "details": { /* optional, field-level */ },
    "requestId": "01J..."           // for log correlation
  }
}
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `invalid_request` | Malformed JSON / failed Zod validation (`details` lists fields) |
| 401 | `unauthenticated` | Missing/invalid/expired Stride session |
| 401 | `provider_not_connected` | Valid Stride session but the health provider has no token (treat as "feature off", not fatal — mirrors `NotConnectedError`) |
| 403 | `forbidden` | CSRF failure / scope mismatch |
| 404 | `not_found` | Unknown session/exercise/resource |
| 409 | `conflict` | Idempotency replay with a different body |
| 422 | `metric_unavailable` | Metric gated (e.g. Recovery before HRV data exists) — `details.reason` |
| 429 | `rate_limited` | Upstream (Fitbit/Google) or our own throttle; `Retry-After` header set |
| 501 | `not_implemented` | Endpoint defined in contract, not yet shipped this phase |
| 502 | `provider_error` | Upstream provider returned an error we can't map |
| 503 | `provider_unconfigured` | Provider env/credentials absent (mirrors today's `fitbitConfigured` 503) |

`metric_unavailable` (422) is the honest-shipping signal: clients render a "needs HRV / needs profile data" state rather than a fake number.

---

## 1. Meta

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/healthz` | none | Liveness probe. Cheap, never touches upstreams (replaces today's `/api/health`). → `{ "status": "ok" }` |
| GET | `/openapi.json` | none | OpenAPI 3.1 spec (source for generated clients). |
| GET | `/v1/meta` | session | Build/version + per-user capability flags. |

`GET /v1/meta` →
```jsonc
{
  "apiVersion": 1,
  "build": "2026.05.29+abc1234",
  "provider": { "type": "fitbit", "connected": true }, // oauth_type flag; "google" after Phase 4
  "capabilities": {                  // drives which dashboards the client shows
    "hrv": true, "recovery": true, "strain": true, "sleep": true,
    "stress": true, "fitnessAge": false, "coach": true, "push": true
  },
  "profileComplete": true            // age/sex/height/waist present (gate for fitnessAge)
}
```

---

## 2. Auth & session

The backend owns provider OAuth end-to-end. Clients never see provider tokens.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/auth/session` | none | Mint a Stride session. Body `{ "email", "password" }` (KS Fit creds) **or** empty body to trigger env auto-login on the self-hosted box. Replaces today's `/api/login` + `auto-login`. |
| DELETE | `/v1/auth/session` | session | Log out; revokes the session row. Replaces `/api/logout`. |
| GET | `/v1/auth/session` | session | Introspect current session: `{ "userId", "createdAt", "expiresAt", "csrfToken" }`. |
| POST | `/v1/auth/session/refresh` | session | Slide the expiry; returns a fresh token (rotation). iOS calls this; web relies on cookie renewal. |

`POST /v1/auth/session` →
```jsonc
// 200
{
  "token": "stride_<base64url-256bit>", // returned in body for iOS; ALSO Set-Cookie for web
  "userId": "u_local",
  "expiresAt": 1735689600000,
  "csrfToken": "<double-submit>"
}
```
Errors: `401 unauthenticated` with `details.reason` of `bad_credentials` (KS Fit code 104) or `rate_limited` (code 141 → also 429 `Retry-After`).

### Provider connection (OAuth2 + PKCE, server-side)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/providers` | session | List providers + connection state: `[{ "type":"fitbit","connected":true,"scopes":[...],"expiresAt":... }]`. |
| POST | `/v1/providers/:type/connect` | session | Begin OAuth. Returns `{ "authorizeUrl" }` (web redirects; iOS opens ASWebAuthSession). Backend holds the PKCE verifier server-side keyed to the session. `:type` ∈ `fitbit` \| `google`. |
| GET | `/v1/providers/:type/callback` | none\* | OAuth redirect target. Exchanges code, encrypts tokens (AES-GCM, `TOKEN_ENC_KEY`) into `oauth_tokens`, then 302s back to the app. \*Authenticated by the signed `state` param, not the session cookie. |
| POST | `/v1/providers/:type/disconnect` | session | Revoke + delete stored tokens. Replaces `/api/fitbit/disconnect`. |

Token refresh is **not** an endpoint — it runs on a background cron off the request path (Phase 2). Clients never refresh provider tokens.

---

## 3. Profile

Required for honest Fitness Age and several derivations (plan §2 prerequisite #2).

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/profile` | session | `{ "ageYears", "sex", "heightCm", "waistCm", "restingHrOverride"?, "maxHrOverride"? }` (nullable until set). |
| PATCH | `/v1/profile` | session | Partial update; same shape. Setting age/sex/height flips `capabilities.fitnessAge`. |

---

## 4. Health metrics (derived, WHOOP-style)

All derived endpoints return the `MetricValue` envelope so the AI coach and UI both cite provenance:

```jsonc
// MetricValue
{ "value": 64, "unit": "ms", "asOf": "2026-05-28", "source": "fitbit", "estimate": true }
```
`estimate:true` marks self-derived/approximated metrics (Recovery, Strain, Stress, Fitness Age) — never claim provider/WHOOP parity. Series endpoints return `{ "points": [{ "date"|"t", ... }], "baseline"?: {...} }`.

### 4.1 Recovery — `GET /v1/metrics/recovery`
Gated behind HRV (`422 metric_unavailable` with `details.reason:"no_hrv"` otherwise).
Params: `?date=YYYY-MM-DD` (default today).
```jsonc
{
  "date": "2026-05-28",
  "score": { "value": 72, "unit": "%", "asOf": "2026-05-28", "source": "fitbit", "estimate": true },
  "label": "Recovery (Stride estimate)",
  "components": {                    // each a z-score vs personal EWMA baseline + weight
    "hrv":          { "z": 0.4,  "weight": 0.50, "metric": { "value": 64, "unit": "ms", ... } },
    "restingHr":    { "z": -0.2, "weight": 0.25, "metric": { "value": 52, "unit": "bpm", ... } },
    "breathingRate":{ "z": 0.1,  "weight": 0.10, "metric": { "value": 14.2,"unit": "brpm", ... } },
    "sleep":        { "z": 0.6,  "weight": 0.15, "metric": { "value": 91, "unit": "%", ... } }
  }
}
```

### 4.2 Strain (Day Strain) — `GET /v1/metrics/strain`
Params: `?date=` or `?from=&to=` for a series.
```jsonc
{
  "date": "2026-05-28",
  "strain": { "value": 12.4, "unit": "0-21", "asOf": "...", "source": "fitbit", "estimate": true },
  "method": "banister_trimp_hrr",
  "selfCalibrated": true,            // mapped to user's own 90-day distribution
  "zones": [ { "name": "Cardio", "minutes": 18 }, ... ],
  "trimp": 142.6
}
```

### 4.3 Sleep — `GET /v1/metrics/sleep`
Params: `?date=` (single night) or `?from=&to=` (series). Direct data + derived need/debt.
```jsonc
{
  "date": "2026-05-28",
  "asleepMin": 437, "inBedMin": 472, "efficiency": 92,   // from SleepSummary
  "stages": { "deep": 78, "light": 240, "rem": 95, "wake": 35 },
  "performance": { "value": 96, "unit": "%", "estimate": true },  // asleep ÷ need
  "need": {
    "value": 455, "unit": "min", "estimate": true,
    "breakdown": { "baseline": 420, "debtAdj": 20, "strainAdj": 15 } // α/β coefficients ours
  },
  "debt": { "value": 63, "unit": "min", "estimate": true, "window": "5-night-decay" },
  "stageNorms": { "deepPct": [13,23], "remPct": [20,25] }          // age-normal ranges
}
```

### 4.4 HRV — `GET /v1/metrics/hrv`
Params: `?from=&to=` (default last 30 nights). Series + personal target band.
```jsonc
{
  "points": [ { "date": "2026-05-28", "rmssd": 64 }, ... ],
  "baseline": { "unit": "ms", "method": "ewma_ln_rmssd_30d",
                "mid": 58, "low": 49, "high": 68 },  // EWMA ± 0.75σ — the band IS the target
  "latest": { "value": 64, "unit": "ms", "asOf": "2026-05-28", "source": "fitbit", "estimate": false },
  "trend": "rising"
}
```

### 4.5 Stress — `GET /v1/metrics/stress`
Most fabrication-prone; always `estimate:true`, labeled HR-based.
Params: `?date=`.
```jsonc
{
  "date": "2026-05-28",
  "label": "Stress (HR-based estimate)",
  "score": { "value": 34, "unit": "0-100", "asOf": "...", "source": "fitbit", "estimate": true },
  "method": "hr_arousal_vs_resting_exercise_excluded",
  "intraday": [ { "t": 1735680000000, "level": 28 }, ... ]  // optional, may be empty
}
```

### 4.6 Fitness Age — `GET /v1/metrics/fitness-age`
Gated behind profile (`422` with `details.reason:"profile_incomplete"`).
```jsonc
{
  "label": "Fitness Age (cardiorespiratory)",
  "fitnessAge": { "value": 31, "unit": "years", "estimate": true },
  "vo2max": { "value": 48, "unit": "ml/kg/min", "source": "fitbit" },
  "method": "vo2max_norm_tables",   // or "non_exercise_regression" fallback (HUNT, coeffs TBV)
  "chronologicalAge": 36
}
```

### 4.7 Daily calories / activity summary — `GET /v1/metrics/activity`
Direct provider data (`DailyActivity`). Params `?date=` or `?from=&to=`.
```jsonc
{ "date":"2026-05-28","steps":8421,"distanceKm":6.1,"caloriesOut":2540,
  "activeMinutes":47,"floors":9 }
```

### 4.8 Heart rate (day) — `GET /v1/metrics/heart-rate`
Mirrors `DayHeartRate`. Params: `?date=`, `?intraday=true|false`.
```jsonc
{ "date":"2026-05-28","restingHr":52,
  "zones":[{"name":"Fat Burn","min":97,"max":135,"minutes":62}, ...],
  "intraday":[{"t":1735680000000,"bpm":71}, ...] }   // empty unless intraday=true
```

### 4.9 Weight — `GET /v1/metrics/weight`, reminder via push
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/metrics/weight` | session | `?from=&to=` → `{ "readings":[{ "t",weightKg,bmi?,fatPct? }], "trend": {...}, "stale": true }` (`WeightReading[]`). `stale:true` when last reading older than the weekly cadence. |
| POST | `/v1/metrics/weight` | session | Write a reading (Fitbit Body / Google Weight). Body `{ "weightKg", "t"? }`. |

---

## 5. Treadmill sessions & exercises

`sessions` = KS Fit / WalkingPad workouts (today's `NormalizedSession`).
`exercises` = Fitbit/Google-detected workouts with HR detail.

### 5.1 Sessions
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/sessions` | session | List, newest-first. Params `?from=&to=&limit=&cursor=`. → `{ items: NormalizedSession[], nextCursor }`. |
| GET | `/v1/sessions/:runId` | session | One session (full `NormalizedSession`). |
| GET | `/v1/sessions/:runId/points` | session | Per-second point series (replaces `/api/export/points/[run_id]`). → `{ points: [{ t, bpm?, speedKmh?, distanceM?, kcal? }] }`. |
| GET | `/v1/sessions/stats` | session | Range rollups (`RangeStats` + per-day `DayBucket`s). Params `?from=&to=`. |
| POST | `/v1/sessions/:runId/push` | session | Push this session to the connected provider as a Walking activity. Idempotent via ledger; accepts `Idempotency-Key`. Replaces `/api/fitbit/log` POST. → `{ "externalId": string\|null, "alreadyLogged": bool }`. |
| GET | `/v1/sessions/:runId/push` | session | Push status for button state. → `{ "alreadyLogged": bool }`. |

`NormalizedSession` (response shape, from `packages/ksfit-client`):
```jsonc
{ "runId":"...","detailId":"...","startTime":1735680000000,"endTime":...,
  "durationSec":1800,"distanceM":3100,"steps":4200,"kcal":210,"heartAvg":118,
  "paceSecPerKm":348,"avgSpeedKmh":10.3,"model":"WalkingPad","deviceId":"...",
  "courseName":"","isAppleWatch":false }
// note: timestamps serialized as epoch-ms (Date in code, number on the wire)
```

### 5.2 Exercises (provider-detected workouts)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/exercises` | session | Provider workout list incl. SmartTrack auto-detected. Params `?from=&to=&limit=&cursor=`. |
| GET | `/v1/exercises/:id` | session | One workout with HR detail. |

```jsonc
// exercise item
{ "id":"fitbit_123","type":"Run","startTime":1735680000000,"durationSec":2400,
  "distanceKm":5.2,"calories":420,"avgHr":151,"autoDetected":true,
  "zones":[{"name":"Cardio","minutes":22}, ...],
  "hr":[{"t":...,"bpm":...}] }   // Google HR is Sample granularity — density validated at migration
```

---

## 6. AI coach (streaming)

Vercel AI SDK + Anthropic `claude-sonnet-4-6`, tool-grounded over §3–§5. The backend
computes every number; the model only interprets and cites. Per-user tool scoping —
the user id comes from the validated session, **never** from the request body.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/coach/conversations` | session | List saved conversations (memory). `{ items:[{ id, title, updatedAt }], nextCursor }`. |
| POST | `/v1/coach/conversations` | session | Create a conversation. → `{ "id" }`. |
| GET | `/v1/coach/conversations/:id` | session | Full message history (`ModelMessage[]`). |
| DELETE | `/v1/coach/conversations/:id` | session | Delete a conversation. |
| POST | `/v1/coach/chat` | session | **Streaming.** Send a turn; stream the assistant reply + tool activity. |

`POST /v1/coach/chat` request:
```jsonc
{
  "conversationId": "c_123",   // optional; omitted → ephemeral
  "messages": [ { "role": "user", "content": "Why is my recovery low today?" } ]
}
```
Response: **Server-Sent Events** (`Content-Type: text/event-stream`), the AI SDK
UI-message stream. Event types:
- `text-delta` — token chunk of the answer.
- `tool-call` / `tool-result` — `{ name, args }` / `{ value, unit, asOf, source }` (so the UI can show "grounded in: HRV 64ms as of 2026-05-28").
- `data-disclaimer` — the mandatory verbatim medical disclaimer (emitted once per advice turn).
- `error` — `{ code, message }` (same error vocab as §0).
- `done` — `{ finishReason, usage }`.

Guardrails enforced server-side (not negotiable): numbers only from tools/snapshot, no diagnosis/prescription, medical-symptom inputs trigger a clinician-escalation message, bounded tool loop `stepCountIs(6)`, prompt-cached prefix (system + tool defs + daily snapshot, ≥1024 tokens). Non-streaming clients may send `Accept: application/json` to get the final `{ "message": {...}, "citations": [...] }` instead of SSE.

---

## 7. Push notifications (weekly weight reminder, Phase 3+)

One `push_subscription` table backs Web Push (VAPID) now and APNs in Phase 5.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/push/vapid-key` | session | VAPID public key for the web client's `PushManager.subscribe`. |
| POST | `/v1/push/subscriptions` | session | Register a subscription. Body: web `{ "kind":"web", "subscription": <PushSubscriptionJSON> }` or iOS `{ "kind":"apns", "deviceToken":"..." }`. → `{ "id" }`. |
| DELETE | `/v1/push/subscriptions/:id` | session | Unregister. |

Delivery (the weekly "update your weight" nudge when `GET /v1/metrics/weight` reports `stale:true`) is fired by a backend cron, not a client endpoint.

---

## 8. Phase mapping (when each ships)

| Section | Phase | Notes |
|---|---|---|
| §1 meta, §2 auth/providers, §5.1 sessions, §4.7–4.9 direct metrics | 1–2 | Wrap today's working routes; auth → opaque tokens in Phase 2. |
| §3 profile, §4.1–4.6 derived metrics, §6 coach, §7 push | 3 | Gated by HRV/profile availability; emit `422 metric_unavailable` until ready. |
| §5.2 exercises, Google provider behind §2 `:type=google` | 4 | Side-by-side via `oauth_type`; validate Google HR sample density. |
| Bearer-token transport on every authed endpoint | 5 | Zero new contract; iOS reuses Phase 2 auth. |

---
Written: `/home/mac12llm/ksfit/docs/architecture/02-API-CONTRACT.md`
