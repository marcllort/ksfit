# Stride — Architecture Overview

> Executive overview of the Stride health-platform evolution. This is the entry point to the architecture docs; deeper detail lives in the linked documents in [Section 6](#6-document-index).

---

## 1. Vision

Stride evolves from a single-user, self-hosted KS Fit / WalkingPad treadmill dashboard (plus a freshly built Fitbit integration) into a **WHOOP-style, self-hosted health platform** — without ever breaking today's working app, and ready for the Fitbit → Google Health API cutover before **September 2026**.

What we are building toward:

- **WHOOP-style dashboards:** Sleep, Recovery, and Day Strain, each with components shown transparently.
- **HRV with baseline + target band:** "where should I be, and how do I get there," built on the user's own EWMA baseline rather than a fabricated "ideal."
- **Stress monitor, sleep debt, sleep recommendations** — honest, self-derived where the upstream APIs don't expose a proprietary score.
- **Fitness age / pace-of-aging analogue** (cardiorespiratory, via VO2max + norm tables — not biological/epigenetic age).
- **Daily calories, per-exercise detail with HR** (including Fitbit auto-detected workouts), and a **weekly weight-update reminder**.
- **An AI coach/trainer** on the Vercel AI SDK, defaulting to Anthropic Claude, grounded by tool-calling over deterministically computed metrics — it interprets and cites, it never invents a health number.

**Architecture shift:** split into a **separate backend and frontend**. Web frontend first, **native iOS soon** — so the backend must be a clean, documented API consumable by both clients from day one. Non-negotiable constraints: proper **security**, **performance**, and **structure**, with an **incremental, plannable migration** that keeps the current app working throughout.

---

## 2. Decision summary

- **Backend stack:** standalone **Hono on Node**, deployed as a second process in the same Docker box behind Caddy. Tiny memory footprint (fits the 384 MB heap), first-class TypeScript, native Zod→OpenAPI. Not Next.js route handlers (welds API lifecycle to the UI), not NestJS (too heavy for the box).
- **API style:** **REST, schema-first**, with Zod schemas in `packages/shared-types` emitting an **OpenAPI** spec — the only choice that cleanly generates *both* a TS client (web) and a Swift client (iOS). tRPC is TS-only; GraphQL is overkill here.
- **Auth model:** the **backend is the sole custodian of third-party OAuth tokens** (encrypted at rest, AES-GCM via `TOKEN_ENC_KEY`). Clients authenticate to *our* backend with an **opaque 256-bit session token** (hashed in DB), delivered as an httpOnly cookie on web and a Keychain Bearer token on iOS — one validation path, two transports.
- **Data layer:** **add SQLite now via Drizzle ORM** (mounted volume, schema kept Postgres-compatible). Required for encrypted tokens, daily metric snapshots/trends, the push-walk dedupe ledger, coach conversation memory, push subscriptions, and sessions. The existing in-memory TTL cache + stampede guard stays as a hot read layer in front of it.
- **AI coach:** **Vercel AI SDK + Anthropic `claude-sonnet-4-6`** (pinned), grounded by **tool-calling over the metrics** (tools return `{value, unit, asOf, source}`) plus a small cache-marked daily snapshot. The backend computes all numbers deterministically; the model only interprets and cites. `claude-haiku-4-5` for cheap background briefings.
- **Provider strategy:** keep the existing `HealthProvider` interface as the seam. Run **Fitbit now** (register as a **Personal app** so intraday HR needs no approval), implement **`GoogleHealthProvider`** against the same interface, run both behind a per-user `oauth_type` flag, and cut over before Sept 2026. Stay **unverified on Google (≤100 users)** — fine for single-user self-hosted, no CASA assessment needed.

---

## 3. Feature feasibility matrix

| Feature | Data source | Buildable now? | Honest approximation (where proprietary) |
|---|---|---|---|
| **Recovery score** | HRV (RMSSD/sleep) + resting HR + breathing rate + sleep performance, each as z-score vs personal EWMA baseline | **approx** (after wiring HRV) | "Recovery (Stride estimate)", weights w_hrv 0.50 / w_rhr 0.25 / w_br 0.10 / w_sleep 0.15 (ours, tunable). Show components; never claim WHOOP parity. **Gate behind HRV availability.** |
| **Day Strain** | Intraday 1-min HR + resting HR + age-derived HRmax | **yes** (shape) | HRR-weighted **Banister TRIMP** → log-mapped to 0–21, **self-calibrated** to the user's own 90-day distribution. Comparable day-over-day for them, not vs a friend's WHOOP. |
| **Sleep dashboard** | Fitbit/Google sleep: asleep/in-bed/efficiency + deep/light/REM/wake | **yes** | Direct data. Stage composition vs age-normal % ranges. |
| **Sleep Performance / Need** | asleep ÷ dynamic need (baseline + debt + strain adj) | **yes / approx** | Itemized need breakdown; α (debt) and β (strain) coefficients are ours, shown transparently. |
| **Sleep debt** | nightly asleep vs need | **yes** | Decaying 5-night accumulator (decay≈0.5); "Est. sleep debt (5 nights)". |
| **HRV + targets** | nightly RMSSD | **yes** (after wiring HRV) | EWMA of ln(RMSSD) over 30 nights ± 0.75σ = personal band. The band *is* the target; no fabricated absolute "ideal HRV." Rising baseline = the real signal. |
| **Stress monitor** | intraday HR elevation vs resting, exercise-excluded; optional intraday HRV | **approx** | **Neither API exposes EDA/Stress Score** — self-derived. "Stress (HR-based estimate)" = physiological arousal, not emotional. Most fabrication-prone; keep claims modest. |
| **Fitness age / pace-of-aging** | Fitbit Cardio Fitness Score (VO2max) → age/sex norm tables; profile age/sex/height/waist | **approx** | "Fitness Age (cardiorespiratory)" via VO2max-vs-norms (HUNT method). Fallback non-exercise regression — **verify Nes 2011 HUNT coefficients from the primary paper before hardcoding**. NOT biological/epigenetic age. |
| **Daily calories** | Fitbit activity summary / Google `Total Calories` + `Active Energy Burned` | **yes** | Direct. |
| **Per-exercise detail w/ HR** | Fitbit `activities/list` (avgHR, zones, minutes) + `heartrate` scope; Google `Exercise` session + correlated HR | **yes** | Direct. Google `Heart Rate` is Sample granularity — validate sample density vs the HR overlay during migration. |
| **Fitbit-detected workouts** | `logType=auto_detected` (SmartTrack) on activity list | **yes** | Direct. |
| **Weekly weight reminder** | Weight read+write (Fitbit Body; Google `Weight` writable) + push subscription + cron | **yes** | Reminder fires when `getWeightTrend` shows a stale reading. |
| **AI coach** | All of the above via tools over `HealthProvider` + derived metrics | **yes** | Tool-grounded, cite-the-source, bounded loop (`stepCountIs(6)`), mandatory medical disclaimer. |

**Two hard prerequisites for honest shipping:**
1. Extend `HealthProvider` with `getHrv`, `getBreathingRate`, `getSpo2`, `getSkinTemp`, `getCardioScore` (all available on Fitbit now, confirmed on Google roadmap).
2. Capture **age, sex, height, waist** in the user profile.

---

## 4. Target architecture at a glance

A pnpm + Turborepo monorepo. Today's `web/` becomes `apps/web`; the `HealthProvider` seam and KS Fit client become shared packages.

```
stride/
  apps/
    web/                  # Next.js 15 — UI ONLY; server components fetch from backend
    backend/              # Hono API: BFF + provider host + derived metrics + AI coach + jobs
    ios/                  # (Phase 5) Swift app, consumes generated OpenAPI client
  packages/
    shared-types/         # Zod schemas + OpenAPI spec + generated TS client
    health-core/          # HealthProvider iface, Fitbit + GoogleHealth providers, normalizers, metrics
    ksfit-client/         # today's lib/ksfit.ts, data.ts, csv.ts, demo.ts
    db/                   # Drizzle schema + migrations + typed repos
  infra/                  # Dockerfile (multi-stage, one image / two processes), Caddyfile, docker-compose.yml
```

**Deployment topology is unchanged:** one multi-stage image runs both processes; Caddy on `treadmill.home` routes `/` → web and `/api` → backend; both bound to localhost; SQLite on a mounted volume so it survives rebuilds. Full detail in [01-ARCHITECTURE](./01-ARCHITECTURE.md).

---

## 5. Phased roadmap at a glance

Each phase is independently shippable; the app stays working throughout. Full detail in [06-ROADMAP](./06-ROADMAP.md).

1. **Monorepo + backend foundation (non-breaking)** — introduce pnpm/Turborepo, move `web/` → `apps/web`, extract shared packages, then stand up the Hono backend as a pass-through and repoint web at it via the generated client.
2. **Database + token custody** — add `packages/db` (Drizzle + SQLite); migrate Fitbit tokens cookie → encrypted DB rows; convert auto-login into `POST /auth/session` minting opaque session tokens; move token refresh to a background cron.
3. **Wire missing signals + WHOOP-style metrics + AI coach** — add HRV, breathing rate, SpO2, skin temp, VO2max and profile fields; build derivation jobs and dashboards; add the AI coach endpoint and Web Push weight reminder.
4. **Google Health provider** — implement `GoogleHealthProvider` against the interface, run side-by-side behind the `oauth_type` flag, validate HR sample density, and cut over before Sept 2026.
5. **iOS native app** — generate a Swift client from the OpenAPI spec, add device pairing + Keychain Bearer flow and APNs tokens. Zero new backend contract work.

---

## 6. Document index

| Doc | Contents |
|---|---|
| **00-OVERVIEW** (this doc) | Vision, decision summary, feature feasibility matrix, document index. |
| [01-ARCHITECTURE](./01-ARCHITECTURE.md) | Monorepo layout, backend/frontend split, deployment topology, where today's code moves, the `HealthProvider` seam. |
| [02-API-CONTRACT](./02-API-CONTRACT.md) | REST + schema-first design, Zod→OpenAPI, generated TS/Swift clients, auth (opaque session tokens, cookie vs Bearer), endpoint inventory. |
| [03-DATA-MODEL](./03-DATA-MODEL.md) | Drizzle + SQLite schema: encrypted tokens, daily metric snapshots, dedupe ledger, sessions, coach memory, push subscriptions; cache layering. |
| [04-FEATURES](./04-FEATURES.md) | Per-feature derivation: Recovery, Strain (TRIMP→0–21), Sleep Need/Performance/debt, HRV band, stress, fitness age — formulas, coefficients, honesty gates. |
| [05-AI-COACH](./05-AI-COACH.md) | Vercel AI SDK + Claude, tool-grounding, prompt caching, bounded loop, per-user scoping, safety/disclaimer guardrails. |
| [06-ROADMAP](./06-ROADMAP.md) | The five phases in detail, shippable increments, open decisions, and must-verify technical risks. |

---

## 7. Open decisions & key risks (carried forward)

**Decisions the user must make:**
- **Database: yes — add SQLite now (Phase 2).** The trend metrics, server-custodied tokens, dedupe ledger, and coach memory all require durable state.
- **Google Health enrollment — verify now.** Confirm OAuth app registration and that staying **unverified (≤100 users)** is acceptable; no CASA unless multi-user/public. Only the *month* (Sept 2026) is published — no exact day.
- **Fitbit app type:** register as **Personal** so intraday HR/HRV need no Issue-Tracker approval.
- **Push approach:** **Web Push (VAPID)** now; **APNs** for iOS in Phase 5 — both keyed off one `push_subscription` table. Confirm Web Push works under LAN trusted-HTTPS (`treadmill.home` + Caddy).

**Must-verify before shipping:**
- **HRV is a hard gate for Recovery** — gate the feature until HRV is wired; show simpler metrics meanwhile.
- **Google `Heart Rate` is Sample granularity** — validate sample density against the HR overlay and stress needs during Phase 4, before cutover.
- **EDA / Stress Management Score exists on neither API** — the stress monitor is fully self-derived; label it "HR-based estimate" and keep claims modest.
- **HUNT (Nes 2011) VO2max coefficients are unverified** — pull from the primary paper before hardcoding the non-exercise fitness-age fallback.
- **Prompt-cache minimum length** — Sonnet needs ≥1024 tokens in the cached prefix; combine system prompt + tool defs + snapshot, and build `ModelMessage`s for message-level caching.
- **Coach guardrails are non-negotiable** — numbers only from tools/snapshot (cite source), no diagnosis/prescription, escalate medical-symptom inputs, mandatory verbatim disclaimer, per-user tool scoping.
