# @stride/db

Drizzle + SQLite (better-sqlite3) persistence layer for Stride. Implements the
entities in [`docs/architecture/03-DATA-MODEL.md`](../../docs/architecture/03-DATA-MODEL.md).
Column choices are Postgres-portable (text PKs, epoch-ms integers, JSON-as-text,
blob for encrypted tokens) so the SQLite→Postgres move is a dialect change.

## Usage

```ts
import { getDb, tokensRepo, sessionsRepo, metricsRepo } from "@stride/db";

const db = getDb();                       // opens + bootstraps the DB
const tokens = tokensRepo(db);
tokens.upsert({ id, userId, provider: "fitbit", accessToken, refreshToken, expiresAt });
const acct = tokens.get(userId, "fitbit"); // decrypted
```

`getDb()` opens the file at `STRIDE_DB_PATH` (default `./stride.db`), enables WAL
+ foreign keys, and runs the idempotent `CREATE TABLE IF NOT EXISTS` bootstrap on
first open. It memoizes one connection per path.

## Environment

| Var | Required | Notes |
|---|---|---|
| `STRIDE_DB_PATH` | no | DB file path; default `./stride.db`. Point at the mounted Docker volume in prod. |
| `TOKEN_ENC_KEY` | yes (for `tokensRepo`) | 32-byte AES-256-GCM key as 64 hex chars or base64. Only needed when encrypting/decrypting provider tokens. |

## Repos

- `tokensRepo` — `provider_accounts`; AES-256-GCM encrypt/decrypt (per-field IV).
- `sessionsRepo` — `app_sessions`; mints opaque tokens, stores only the SHA-256 hash.
- `metricsRepo` — `daily_scores` (derived snapshots) + `cached_metrics` (durable day-grained provider cache).
- `coachRepo` — `coach_conversations` + `coach_messages`; stores ModelMessage parts as JSON, user-scoped reads.
- `pushRepo` — `push_subscriptions`; Web Push (VAPID) + APNs in one table.
- `dedupeRepo` — `pushed_activities`; the push-walk dedupe ledger.

## Migrations

drizzle-kit is the preferred path for CI / Postgres:

```
pnpm --filter @stride/db db:generate   # emit SQL from src/schema.ts
pnpm --filter @stride/db db:migrate
```

The runtime bootstrap (`BOOTSTRAP_DDL`) keeps the self-hosted single-file deploy
zero-ops; it is kept in lock-step with `src/schema.ts`.
