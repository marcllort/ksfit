/**
 * Idempotent bootstrap DDL for the self-hosted single-file SQLite deploy.
 *
 * Kept in lock-step with the Drizzle table definitions in ./schema.ts. Every
 * statement is CREATE TABLE / INDEX IF NOT EXISTS, so running it against an
 * existing database is a no-op. drizzle-kit migrations (db:generate / db:migrate)
 * remain the preferred path for CI and the eventual Postgres move; this string is
 * the zero-ops bootstrap getDb() runs on first open.
 */

export const BOOTSTRAP_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  ksfit_xjid TEXT UNIQUE,
  display_name TEXT,
  birth_date TEXT,
  sex TEXT,
  height_cm REAL,
  waist_cm REAL,
  hr_max_override INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_user_id TEXT,
  access_token_enc BLOB NOT NULL,
  refresh_token_enc BLOB,
  enc_iv BLOB NOT NULL,
  enc_tag BLOB NOT NULL,
  expires_at INTEGER,
  scope TEXT,
  connected_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_accounts_user_provider
  ON provider_accounts (user_id, provider);

CREATE TABLE IF NOT EXISTS app_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  transport TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS cached_metrics (
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider, kind, metric_date)
);

CREATE TABLE IF NOT EXISTS daily_scores (
  user_id TEXT NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  recovery REAL,
  recovery_components TEXT,
  strain REAL,
  trimp REAL,
  hrv_rmssd REAL,
  hrv_ln_ewma REAL,
  hrv_band_low REAL,
  hrv_band_high REAL,
  resting_hr INTEGER,
  breathing_rate REAL,
  spo2 REAL,
  skin_temp_dev REAL,
  sleep_asleep_min INTEGER,
  sleep_in_bed_min INTEGER,
  sleep_efficiency INTEGER,
  sleep_stages TEXT,
  sleep_need_min INTEGER,
  sleep_need_breakdown TEXT,
  sleep_performance REAL,
  sleep_debt_min INTEGER,
  calories_out INTEGER,
  vo2max REAL,
  fitness_age REAL,
  stress_estimate REAL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS exercise_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  log_type TEXT NOT NULL,
  activity TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  duration_sec INTEGER NOT NULL,
  distance_m REAL,
  calories INTEGER,
  avg_hr INTEGER,
  max_hr INTEGER,
  hr_zones TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS exercise_sessions_user_provider_external
  ON exercise_sessions (user_id, provider, external_id);

CREATE TABLE IF NOT EXISTS pushed_activities (
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  source_id TEXT NOT NULL,
  external_id TEXT,
  pushed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider, source_id)
);

CREATE TABLE IF NOT EXISTS coach_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coach_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES coach_conversations(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_calls_json TEXT,
  token_usage TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  keys_json TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  revoked_at INTEGER
);
`;
