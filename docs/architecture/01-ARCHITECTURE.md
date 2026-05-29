# 01 — Target Architecture: Backend + Frontend Split

**Status:** Proposed (authoritative target). **Date:** 2026-05-29.
**Scope:** The full backend/frontend split for Stride — a WHOOP-style, self-hosted health platform. Web frontend first, iOS native app soon. Must never break today's working single-container app, and must be ready for the Fitbit → Google Health API cutover before **September 2026**.

This document is the destination. The incremental, ship-at-every-step path to get there is in [§9 Migration path (non-breaking)](#9-migration-path-non-breaking).

---

## 1. Guiding principles

1. **One backend, two clients.** The backend is a clean, documented HTTP API. The web app and the (future) iOS app are *both* just clients of it. No business logic lives in a client.
2. **The backend is the sole custodian of third-party secrets.** Fitbit / Google OAuth tokens never leave the server. Clients hold only an opaque session token scoped to *our* API.
3. **The `HealthProvider` interface stays the migration seam.** Everything provider-specific (Fitbit today, Google Health tomorrow) hides behind `web/src/lib/health/types.ts`'s `HealthProvider`. Adding a provider is a localized change, not a rewrite — the code already documents this intent.
4. **Numbers are computed deterministically on the server.** The AI coach interprets and cites; it never calculates or invents a health value.
5. **Never break the running app.** Every phase in §9 is independently shippable; `treadmill.home` keeps serving the dashboard the entire time.

---

## 2. Monorepo layout (concrete)

pnpm workspace + Turborepo. Today's `web/` becomes `apps/web`; the `HealthProvider` seam and the KS Fit client become shared packages.

```
stride/
├── apps/
│   ├── web/                       # Next.js 15 (App Router, TS strict, Tailwind)
│   │   ├── src/app/               # pages + components — UI ONLY
│   │   │                          #   server components fetch from the backend
│   │   │                          #   via the generated TS client
│   │   └── package.json
│   ├── backend/                   # Hono on Node — the API
│   │   ├── src/
│   │   │   ├── index.ts           # Hono app bootstrap, /api mount, health check
│   │   │   ├── routes/            # one file per resource (sessions, fitbit,
│   │   │   │                      #   metrics, coach, auth, export, push)
│   │   │   ├── middleware/        # auth (session-token validation), error,
│   │   │   │                      #   request logging, rate-limit
│   │   │   ├── lib/
│   │   │   │   ├── cache.ts        # ported from web/src/lib/cache.ts
│   │   │   │   ├── auth/           # session minting + validation (opaque tokens)
│   │   │   │   ├── coach/          # model, systemPrompt, tools, context, memory
│   │   │   │   └── jobs/           # cron: token refresh, daily snapshots, reminders
│   │   │   └── openapi.ts          # serves the generated OpenAPI spec
│   │   └── package.json
│   └── ios/                        # (Phase 5) Swift app — consumes generated
│                                   #   OpenAPI Swift client; zero new contract work
├── packages/
│   ├── shared-types/               # Zod schemas → OpenAPI spec → generated TS client
│   │   ├── src/schemas/            # request/response Zod schemas (the contract)
│   │   ├── openapi.json            # emitted spec (source of both clients)
│   │   └── src/client/             # generated TS fetch client (used by apps/web)
│   ├── health-core/                # the provider seam + derived metrics
│   │   ├── src/types.ts            # HealthProvider iface (from lib/health/types.ts)
│   │   ├── src/fitbit/             # provider, pkce, logged  (from lib/health/fitbit/*)
│   │   │                           #   tokens.ts persistence swapped cookie → packages/db
│   │   ├── src/google/             # GoogleHealthProvider (Phase 4)
│   │   ├── src/fetchers.ts         # from lib/health/fetchers.ts
│   │   └── src/metrics/            # HRV baseline, sleep debt/need, strain, recovery,
│   │                               #   fitness age — deterministic, unit-tested
│   ├── ksfit-client/               # treadmill data layer (from lib/*)
│   │   └── src/{ksfit,data,csv,demo}.ts
│   └── db/                         # Drizzle schema + migrations + typed repos
│       ├── src/schema.ts           # tokens, sessions, daily_metrics, dedupe_ledger,
│       │                           #   coach_messages, push_subscriptions, profile, settings
│       ├── src/repos/              # tokens, sessions, snapshots, coach, push
│       └── migrations/
├── infra/
│   ├── Dockerfile                  # multi-stage; one image runs two processes
│   ├── docker-compose.yml          # ksfit (web+backend) + optional caddy profile
│   └── Caddyfile.docker            # treadmill.home → / web, /api backend
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**Where today's code moves** (verified against the current tree):

| Today (`/home/mac12llm/ksfit/...`) | Destination |
|---|---|
| `web/src/lib/health/types.ts` | `packages/health-core/src/types.ts` (unchanged — the seam) |
| `web/src/lib/health/fitbit/{provider,pkce,logged}.ts` | `packages/health-core/src/fitbit/` |
| `web/src/lib/health/fitbit/tokens.ts` | `packages/health-core/src/fitbit/tokens.ts` — **persistence swapped cookie → `packages/db` (encrypted)** |
| `web/src/lib/health/fetchers.ts` | `packages/health-core/src/fetchers.ts` (coach tools wrap these) |
| `web/src/lib/{ksfit,data,csv,demo}.ts` | `packages/ksfit-client/src/` |
| `web/src/lib/cache.ts` | `apps/backend/src/lib/cache.ts` (server-side, in-memory hot layer) |
| `web/src/lib/{session,auto-login}.ts` | `apps/backend/src/lib/auth/` — auto-login becomes `POST /api/v1/auth/session` minting opaque tokens |
| `web/src/lib/settings/*` | schema → `packages/shared-types`; persistence → `packages/db` |
| `web/src/app/api/**` (login, logout, health, fitbit/*, export/*) | `apps/backend/src/routes/` (Hono) with Zod schemas |
| `web/src/app/**` (pages, components) | `apps/web/src/app/` — fetch from backend via generated client |
| `docker-compose.yml`, `Caddyfile.docker`, `Dockerfile` | `infra/` (extended with the backend process) |
| `ksfit/` (Python client) | repo root unchanged (separate runtime) |

---

## 3. Backend stack choice + ADR

### Decision: **Hono on Node**, run as a second process in the same container.

**Context.** The box is tight (`NODE_OPTIONS=--max-old-space-size=384`, 512M container limit, 1 CPU — confirmed in `docker-compose.yml`). We need a standalone API decoupled from the UI lifecycle, first-class TypeScript, and native Zod→OpenAPI so we can generate *both* a TS web client and a Swift iOS client.

**Options considered.**
- **Next.js route handlers (status quo).** Welds the API lifecycle to the UI deploy; can't serve a native client cleanly; no first-class OpenAPI. ❌
- **NestJS.** Strong structure and DI, but heavy DI/reflection footprint and startup cost — wasteful on a 384 MB heap shared with Next.js. ❌
- **Fastify.** Solid, but its OpenAPI/JSON-schema story is more ceremony than Hono's Zod-native one, and it's heavier. ⚠️
- **Hono on Node.** Tiny memory footprint, fast cold start, first-class TS, `@hono/zod-openapi` emits the spec directly from the route Zod schemas. ✅

**Decision drivers.** Memory headroom on the shared box; one set of Zod schemas as the single source of truth for validation *and* the OpenAPI contract *and* both generated clients; clean separation from the Next.js render lifecycle.

**Consequences.** Two Node processes in one image (web `:3000`, backend `:3001`), both bound to loopback, fronted by Caddy. Slightly more orchestration in the Dockerfile/compose (acceptable — see §7). The API contract becomes the artifact everything else is generated from.

---

## 4. API style

**REST, schema-first, versioned under `/api/v1/`.**

- **Zod schemas in `packages/shared-types`** are the contract. Hono routes import them for runtime validation; `@hono/zod-openapi` emits `openapi.json`.
- **OpenAPI is the only choice** that generates both a **TS client** (web) and a **Swift client** (iOS) from one source. tRPC is TypeScript-only (dead-ends iOS); GraphQL is overkill for a single-user metrics API.
- **Resources** (illustrative): `GET /api/v1/sessions`, `GET /api/v1/sessions/{id}`, `GET /api/v1/health/heart-rate`, `GET /api/v1/health/sleep`, `GET /api/v1/metrics/recovery|strain|sleep|hrv`, `POST /api/v1/coach/chat`, `POST /api/v1/auth/session`, `DELETE /api/v1/auth/session`, `GET /api/v1/export/sessions.csv`, fitbit connect/callback/disconnect/log, push subscribe.
- **Errors** are a single typed shape (`{ error: { code, message } }`) defined once in `shared-types`.
- **The generated TS client** is what `apps/web` server components call — no hand-written fetch glue, no drift between client and server.

---

## 5. Auth model

**Two transports, one validation path.** The backend authenticates clients with an **opaque 256-bit session token** (random, stored in the DB as a SHA-256 hash, never reversible). It is *not* a JWT — revocation is a row delete, and there is no third-party data inside it.

- **Web:** session token delivered as an **httpOnly, Secure, SameSite cookie** (replacing today's `web/src/lib/session.ts` cookie). Browser never sees the raw token in JS.
- **iOS (Phase 5):** same token delivered as a **Bearer header**, stored in the **Keychain**. Device pairing mints the token via the same `POST /api/v1/auth/session` endpoint.
- **One middleware** (`apps/backend/src/middleware/auth.ts`) reads the token from *either* the cookie *or* the `Authorization` header, hashes it, looks it up, and attaches the resolved user. Two transports, one code path.

**Third-party token custody (the load-bearing part).**
- Fitbit / Google OAuth tokens live **only in the backend DB**, **encrypted at rest with AES-256-GCM** under `TOKEN_ENC_KEY` (env). This relocates `web/src/lib/health/fitbit/tokens.ts` from an httpOnly cookie into `packages/db` (encrypted rows). The `HealthProvider` interface is unchanged — only the persistence backing `tokens.ts` changes.
- **Token refresh moves off the request path** into a background cron job (§7), so a user request never blocks on a Fitbit/Google refresh round-trip.
- **Per-user OAuth flag (`oauth_type`):** `fitbit` | `google`, enabling side-by-side providers during the Phase 4 cutover.
- **Auto-login** (today's `auto-login.ts` from env creds) becomes a server-side mint of a session token at startup for the single self-hosted user — same UX, now backed by the DB.

**Coach scoping:** the coach's tools are scoped to the authenticated user server-side. A client-supplied user id is **never** trusted.

---

## 6. Data layer

**Add SQLite now, via Drizzle ORM, on a mounted volume** (`packages/db`). Schema kept Postgres-compatible so a future move off SQLite is mechanical.

This is the one structural commitment beyond today's stateless design, and it is required by the target feature set:

| Table | Why it must persist |
|---|---|
| `oauth_tokens` | Encrypted third-party tokens (custody, refresh) |
| `sessions` | Opaque session-token hashes (web cookie + iOS bearer) |
| `daily_metrics` | WHOOP-style trend snapshots: HRV baseline/band, sleep debt/need/performance, strain, recovery, fitness age — computed once per day by a job, read cheaply |
| `dedupe_ledger` | Push-walk dedupe so a session is never double-logged to Fitbit |
| `coach_messages` | AI coach conversation memory |
| `push_subscriptions` | Web Push (VAPID) now; APNs tokens in Phase 5 — one table, two channels |
| `profile` | age / sex / height / waist (hard prerequisite for fitness age & strain HRmax) |
| `settings` | persisted from today's `lib/settings/*` |

**Caching:** the existing in-memory TTL cache + stampede guard (`web/src/lib/cache.ts`) ports to `apps/backend/src/lib/cache.ts` and stays as a **hot read layer in front of SQLite and the provider APIs** — protecting Fitbit/Google rate limits and keeping reads fast.

**Volume:** the SQLite file lives on a Docker-mounted volume so it survives image rebuilds.

---

## 7. Deployment on treadmill.home (Caddy + Docker)

**Topology unchanged in spirit: one image, LAN-only, trusted local HTTPS.** Now the single image runs **two processes**.

- **Multi-stage Dockerfile** builds the Turborepo, prunes to `apps/web` + `apps/backend` + their package deps, and produces one runtime image. A tiny process manager (or a supervised `node` entrypoint) starts both:
  - **web** on `127.0.0.1:3000` (Next.js)
  - **backend** on `127.0.0.1:3001` (Hono)
- **Caddy** on `treadmill.home` (from `Caddyfile.docker`) routes:
  ```
  treadmill.home {
      tls internal
      encode zstd gzip
      handle /api/* { reverse_proxy ksfit:3001 }
      handle        { reverse_proxy ksfit:3000 }
  }
  ```
- **Memory:** Hono's footprint is small; the existing `--max-old-space-size=384` budget and 512M container limit stay realistic with both processes (revisit if the coach/jobs grow heap pressure).
- **Secrets:** `web/.env.local` (loaded via `env_file` today) gains `TOKEN_ENC_KEY`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `VAPID_*`. Stays out of the image.
- **Volumes:** add the SQLite data volume alongside `caddy_data`/`caddy_config`.
- **Health check:** keep the existing `/api/health` probe; it now targets the backend.
- **Cron / background jobs** run inside the backend process (token refresh, daily snapshot derivation, weekly weight reminder) — off the request path.

---

## 8. Security & performance

**Security**
- Third-party tokens encrypted at rest (AES-256-GCM, `TOKEN_ENC_KEY`); never sent to any client.
- Opaque session tokens, hashed in DB; httpOnly+Secure+SameSite cookie (web) / Keychain bearer (iOS); revocable by row delete.
- Everything bound to `127.0.0.1`; only Caddy is exposed, on the LAN IP, over trusted-internal TLS. `no-new-privileges` retained.
- All request bodies validated by Zod at the route boundary; reject-by-default.
- Coach guardrails: numbers only from tools/snapshot (cited), no diagnosis/prescription, escalate medical-symptom inputs, mandatory verbatim disclaimer, per-user tool scoping.
- Per-user OAuth scoping; client-supplied user ids never trusted.

**Performance**
- In-memory TTL cache + stampede guard in front of SQLite and provider APIs (protects Fitbit/Google rate limits).
- Daily metric snapshots precomputed by jobs → dashboard reads are cheap DB hits, not recomputation.
- Token refresh and derivations are off the request path (background cron).
- AI coach uses prompt caching: combine system prompt + tool defs + daily snapshot into one cached prefix (Sonnet needs ≥1024 cached tokens); build `ModelMessage`s for message-level caching; bound the loop with `stepCountIs(6)`.
- Hono's low overhead keeps the second process within the 384 MB heap budget.

---

## 9. Migration path (non-breaking)

Every phase ships independently; `treadmill.home` keeps serving the dashboard throughout.

**Phase 1 — Monorepo + backend foundation.**
- Introduce pnpm/Turborepo; move `web/` → `apps/web`; extract `packages/{ksfit-client, health-core}`; repoint imports. App is byte-for-byte identical — route handlers still call the packages directly. **Ship.**
- Stand up `apps/backend` (Hono) as a **pass-through**: move `app/api/**` endpoints over one at a time with Zod schemas + OpenAPI; point `apps/web` server components at the backend via the generated TS client; add the Caddy `/api` route. Backend still uses cookie/process-memory internally (no DB yet). **Ship — web now talks to a real, documented API.**

**Phase 2 — Database + token custody.**
- Add `packages/db` (Drizzle + SQLite, mounted volume). Migrate Fitbit tokens cookie → encrypted DB rows (`HealthProvider` unchanged; only `tokens.ts` persistence changes). Convert auto-login into `POST /api/v1/auth/session` minting opaque session tokens (web swaps cookie contents; iOS-ready). Add the dedupe ledger, daily-metrics, sessions, and push-subscription tables. Token refresh moves to a background cron. **Ship — tokens server-custodied.**

**Phase 3 — Missing signals + WHOOP-style metrics + AI coach.**
- Extend `HealthProvider`/fetchers with `getHrv`, `getBreathingRate`, `getSpo2`, `getSkinTemp`, `getCardioScore`; add profile fields (age/sex/height/waist).
- Build derivation jobs writing daily snapshots (HRV baseline/band, sleep debt, Sleep Need/Performance, Strain → 0–21, Recovery, Fitness Age). Expose as REST resources; build dashboards in `apps/web`. **Gate Recovery/HRV behind HRV availability.**
- Add `POST /api/v1/coach/chat` (Vercel AI SDK + Anthropic `claude-sonnet-4-6`, tool-grounded, prompt-cached, `stepCountIs(6)`, safety prompt; `claude-haiku-4-5` for background briefings). Add Web Push (VAPID) for the weekly weight reminder (cron). **Ship incrementally per metric.**

**Phase 4 — Google Health provider.**
- Implement `GoogleHealthProvider` (`health.googleapis.com/v4`) against the same interface. Field-map each Fitbit call; run side-by-side behind the `oauth_type` flag; re-consent via incremental auth (tokens non-transferable). Validate Google `Heart Rate` Sample density vs the HR overlay/stress needs. **Cut over before Sept 2026.** **Ship as a config flip.**

**Phase 5 — iOS native app.**
- Generate a Swift client from the OpenAPI spec; implement device pairing + Keychain Bearer flow (auth from Phase 2); add APNs tokens to the existing push table. **Zero new backend contract work. Ship.**

---

## 10. Open decisions / must-verify

- **Google Health enrollment:** confirm the OAuth app can be registered and that staying **unverified (≤100 users)** is acceptable (it is, for single-user — no CASA assessment). Only the *month* of the Sept 2026 cutover is published; time-box accordingly.
- **Fitbit app type:** register as **Personal** so intraday HR/HRV need no Issue-Tracker approval during the interim.
- **HRV is a hard gate** for an honest Recovery score — gate the feature, show simpler metrics until HRV is wired.
- **Google `Heart Rate` is Sample granularity**, not a named "intraday" type — validate density in Phase 4 before cutover.
- **EDA / Stress Score exists on neither API** — the stress monitor is self-derived from HR arousal; label it "HR-based estimate."
- **HUNT (Nes 2011) VO2max coefficients are unverified** — pull from the primary paper before hardcoding the non-exercise fitness-age fallback; prefer device VO2max + norm tables.
- **Web Push under LAN trusted-HTTPS:** confirm VAPID works on `treadmill.home` + Caddy before relying on the weekly reminder.
