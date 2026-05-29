# 06 — Implementation Roadmap: Monolith → Platform

**Status:** Authoritative. **Date:** 2026-05-29.
**Scope:** The phased, ship-at-every-step path from today's single-container Next.js app to the full WHOOP-style backend/frontend platform. Companion to [01-ARCHITECTURE.md](01-ARCHITECTURE.md) (the destination), [02-API-CONTRACT.md](02-API-CONTRACT.md), and [03-DATA-MODEL.md](03-DATA-MODEL.md).

## Governing rules

- **Every phase is independently shippable.** `treadmill.home` keeps serving the working dashboard the entire time.
- **Phase 1 is strictly non-breaking** — a pure refactor + a pass-through API. No behavior, no data, no deployment topology changes that the user can observe.
- **The `HealthProvider` interface is the migration seam.** Provider swaps (Fitbit → Google) are localized; never a rewrite.
- **Numbers are computed deterministically on the server.** The AI coach interprets and cites; it never calculates a health value.
- **Hard deadline:** the Fitbit legacy Web API deprecates **September 2026**. Phase 4 (Google Health provider) MUST complete before then. Only the *month* is published — treat any day in September as the cutoff and back-plan.

Today's relevant code (verified to exist): `web/src/lib/health/{types.ts,fetchers.ts}`, `web/src/lib/health/fitbit/*`, `web/src/lib/{ksfit.ts,data.ts,csv.ts,demo.ts,cache.ts,session.ts,auto-login.ts}`, `web/src/lib/settings/*`, `web/src/app/api/**`, `docker-compose.yml`, `Caddyfile.docker`.

---

## Phase 0 — Pre-work (verify before committing code)

**Goal:** Resolve the external unknowns that gate later phases so the roadmap doesn't stall mid-flight.

**Deliverables**
- Register the Fitbit app as **Personal** (intraday HR/HRV need no Issue-Tracker approval).
- Confirm Google Health API OAuth app can be registered and that **unverified (≤100 users)** is acceptable for single-user self-hosting (it is; no CASA assessment unless multi-user/public).
- Confirm Web Push (VAPID) works under the LAN trusted-HTTPS setup (`treadmill.home` + Caddy).
- Pull and record the **Nes 2011 HUNT VO2max coefficients** from the primary paper (needed for the fitness-age fallback in Phase 3).

**Files/dirs touched:** none (external + `docs/`).

**Verification:** A checklist in `docs/` with each item confirmed and dated; Fitbit Personal app credentials in `web/.env.local`.

---

## Phase 1 — Monorepo + backend foundation (NON-BREAKING)

**Goal:** Introduce the monorepo and a real, documented backend without changing a single observable behavior. The app stays byte-for-byte equivalent at each sub-step.

### Phase 1a — Monorepo + package extraction (pure refactor)

**Deliverables**
- Introduce **pnpm + Turborepo** (`pnpm-workspace.yaml`, `turbo.json`).
- Move `web/` → `apps/web` (unchanged contents).
- Extract `packages/ksfit-client/` from `web/src/lib/{ksfit.ts,data.ts,csv.ts,demo.ts}`.
- Extract `packages/health-core/` from `web/src/lib/health/{types.ts,fetchers.ts}` and `web/src/lib/health/fitbit/*`.
- Repoint imports in `apps/web`. Route handlers still call the packages directly — no API hop yet.

**Files/dirs touched:** new `pnpm-workspace.yaml`, `turbo.json`, `packages/ksfit-client/`, `packages/health-core/`; moved `apps/web/**`; edited imports across `apps/web/src/**`.

**Verification:** `pnpm install && pnpm -r build` is green; existing `web/src/lib/__tests__` pass under the new paths; `docker compose up` serves the identical dashboard; diff of rendered pages is empty.

### Phase 1b — Hono backend as a pass-through

**Deliverables**
- Stand up `apps/backend` (**Hono on Node**, second process in the same Docker image).
- Add `packages/shared-types/` — **Zod schemas → OpenAPI spec → generated TS client**.
- Port `apps/web/src/app/api/**` endpoints to Hono **one at a time**, each with a Zod schema and OpenAPI entry. Backend still uses cookie/process-memory internally (no DB yet); it calls `packages/health-core` and `packages/ksfit-client`.
- Move `web/src/lib/cache.ts` → `apps/backend` (in-memory server cache + stampede guard).
- Point `apps/web` server components at the backend via the generated client.
- Extend Caddy: `/` → web, `/api` → backend; both bound to localhost.

**Files/dirs touched:** new `apps/backend/**`, `packages/shared-types/**`; deleted/redirected `apps/web/src/app/api/**`; edited `apps/web` server components; `Caddyfile.docker`, `docker-compose.yml`, `Dockerfile` (multi-stage, one image / two processes).

**Verification:** OpenAPI spec validates; generated TS client type-checks against `apps/web`; every migrated endpoint returns identical payloads to the pre-migration version (capture before/after fixtures); the full dashboard + Fitbit tab + HR overlay work end-to-end through `/api`. **Ship — web now talks to a real, documented API.**

---

## Phase 2 — Database + server-custodied tokens

**Goal:** Give the backend durable state and make it the sole custodian of third-party secrets, without changing the `HealthProvider` interface.

**Deliverables**
- Add `packages/db/` — **Drizzle + SQLite** on a mounted volume, schema kept Postgres-compatible. Tables: encrypted `oauth_tokens`, `sessions`, `daily_metrics` snapshots, push-walk **dedupe ledger**, `push_subscriptions`, `coach_messages`, settings.
- Migrate Fitbit tokens **cookie → encrypted DB rows** (AES-GCM via `TOKEN_ENC_KEY`). Only `health-core`'s `tokens.ts` persistence changes; the interface does not.
- Convert auto-login (`session.ts` + `auto-login.ts`) into `POST /auth/session` minting an **opaque 256-bit session token** (hashed in DB). Web stores it in the existing httpOnly cookie (transport unchanged for the user); iOS-ready as a Keychain Bearer.
- Move Fitbit **token refresh to a background cron**, off the request path.

**Files/dirs touched:** new `packages/db/**`; edited `packages/health-core/.../tokens.ts`; `apps/backend` auth + cron; `docker-compose.yml` (volume); `.env` (`TOKEN_ENC_KEY`).

**Verification:** Restarting the container preserves login and Fitbit connection (no re-auth); tokens never appear in cookies or client payloads; dedupe ledger prevents duplicate push-walks; migration script moves an existing cookie token into an encrypted row without a reconnect. **Ship — tokens server-custodied.**

---

## Phase 3 — Missing signals + WHOOP-style metrics + AI coach

**Goal:** Wire the physiological signals, compute the WHOOP-style derived metrics deterministically, surface dashboards, and add the tool-grounded AI coach. Ship incrementally, one metric at a time.

**Deliverables**
- Extend `HealthProvider`/fetchers with `getHrv`, `getBreathingRate`, `getSpo2`, `getSkinTemp`, `getCardioScore` (all available on Fitbit now).
- Add profile fields **age, sex, height, waist** (required for strain HRmax and fitness age).
- Derivation jobs writing `daily_metrics` snapshots: HRV EWMA baseline/band, sleep debt (decaying 5-night accumulator), Sleep Need/Performance, **Day Strain** (HRR-weighted Banister TRIMP → log-mapped 0–21, self-calibrated to the user's 90-day distribution), Recovery (z-scored components), Fitness Age (VO2max vs HUNT norms; non-exercise regression fallback).
- Expose each as a REST resource (Zod + OpenAPI); build dashboards in `apps/web`.
- **Gate Recovery and HRV behind HRV availability** — show simpler metrics until HRV is flowing. Label self-derived metrics honestly ("Stress (HR-based estimate)", "Recovery (Stride estimate)", "Fitness Age (cardiorespiratory)").
- AI coach: `POST /v1/coach/chat` (**Vercel AI SDK + `claude-sonnet-4-6`**, `claude-haiku-4-5` for background briefings). Tool-grounded over the metrics (tools return `{value, unit, asOf, source}`), prompt-cached prefix (system + tools + daily snapshot ≥1024 tokens), `stepCountIs(6)`, mandatory medical disclaimer, per-user tool scoping (never trust client-supplied user id).
- Web Push (VAPID) weekly weight reminder via cron, keyed off `getWeightTrend` staleness.

**Files/dirs touched:** `packages/health-core/` (interface, fetchers, normalizers, metrics); `packages/db/` (snapshot schema); `apps/backend/lib/coach/{model,systemPrompt,tools,context,memory}.ts` + coach route + derivation jobs; `apps/web` dashboards; `packages/shared-types` (new resources + profile schema).

**Verification:** Each metric's numbers reproduce a hand-computed reference for a known day; Recovery/HRV are hidden when HRV is absent; coach answers cite the source for every number and refuses to compute/diagnose; disclaimer appears verbatim on advice; weekly reminder fires on a stale weight. **Ship per metric.**

---

## Phase 4 — Google Health provider (TIED TO SEPT 2026 DEADLINE)

**Goal:** Implement the Google Health API provider behind the same interface and cut over from Fitbit **before September 2026**.

**Deliverables**
- Implement `GoogleHealthProvider` (REST `health.googleapis.com/v4`) against the existing `HealthProvider` interface.
- Build/use the migration **Parity Tool** to field-map each Fitbit call to its Google equivalent.
- Add a per-user `oauth_type` flag; run **both providers side-by-side**. Re-consent via incremental auth (tokens are non-transferable between providers).
- **Validate Google `Heart Rate` Sample density** against the HR-overlay and stress needs before cutover.
- Flip the flag to Google as the default. Keep Fitbit selectable until its API goes dark.

**Files/dirs touched:** new `packages/health-core/.../google-health/*`; `packages/db/` (`oauth_type` column); `apps/backend` connect/callback for Google; `packages/shared-types` (provider enum).

**Verification:** Side-by-side report shows each Fitbit metric matches its Google counterpart within tolerance for the same day; HR overlay renders acceptably from Google Sample data; a fresh user can connect via Google end-to-end; cutover is a config flip with no client changes. **Complete and cut over before September 2026.**

---

## Phase 5 — iOS native app

**Goal:** Ship a native iOS client with **zero new backend contract work**.

**Deliverables**
- Generate a **Swift client from the OpenAPI spec**.
- Implement device pairing + **Keychain Bearer** flow (reusing the opaque-session auth from Phase 2).
- Add **APNs** tokens to the existing `push_subscriptions` table (same table as Web Push).
- Build the iOS dashboards/coach UI against the generated client.

**Files/dirs touched:** new `apps/ios/**`; `packages/db` (push-subscription `kind`/`apns` fields only if needed); no new backend routes.

**Verification:** Swift client compiles from the live OpenAPI spec; login via Keychain Bearer hits the same auth path as web; a push reminder is delivered via APNs; all dashboards and the coach work natively. **Ship.**

---

## Deadline back-plan (summary)

| Phase | Gating constraint |
|---|---|
| 0 | Unblocks everything; do first. |
| 1 | No external dependency; non-breaking. |
| 2 | Required before Phase 4 (token custody + `oauth_type`). |
| 3 | Independent of the deadline; ship incrementally. |
| **4** | **MUST finish before September 2026 (Fitbit API deprecation).** |
| 5 | No deadline; reuses Phase 2 auth + Phase 1 OpenAPI. |
