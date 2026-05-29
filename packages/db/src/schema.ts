/**
 * Drizzle SQLite schema for Stride (`packages/db`).
 *
 * Mirrors docs/architecture/03-DATA-MODEL.md. Column choices are kept
 * Postgres-portable so a later move to Postgres is a dialect + connection-string
 * change, not a rewrite:
 *   - all PKs are app-generated text (UUID/ULID), stable across SQLite→Postgres
 *   - all timestamps are Unix epoch MILLISECONDS stored as integer
 *     (matching HeartRatePoint.t / WeightReading.t)
 *   - JSON payloads are stored as text (parsed/serialized in the repos); this
 *     maps cleanly to Postgres `jsonb` on migration
 *   - encrypted token material is stored as blob (AES-256-GCM ciphertext/iv/tag)
 *
 * The system is single-user today but every table carries `user_id` so iOS or a
 * second account is a data change, not a structural one.
 */

import {
  blob,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/* -------------------------------------------------------------------------- */
/* 2.1 users — single self-hosted user; multi-user-ready column set           */
/* -------------------------------------------------------------------------- */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // ULID
  ksfitXjid: text("ksfit_xjid").unique(), // ties our user to upstream KS Fit
  displayName: text("display_name"),
  // Profile (required for honest metrics: HRmax, fitness age, norm tables)
  birthDate: text("birth_date"), // YYYY-MM-DD; drives age → HRmax / fitness-age norms
  sex: text("sex"), // 'male' | 'female' | 'unspecified'
  heightCm: real("height_cm"),
  waistCm: real("waist_cm"),
  hrMaxOverride: integer("hr_max_override"), // measured max if known; else age-derived
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/* -------------------------------------------------------------------------- */
/* 2.2 provider_accounts — OAuth token custody, AES-256-GCM encrypted at rest */
/* -------------------------------------------------------------------------- */

export const providerAccounts = sqliteTable(
  "provider_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(), // 'fitbit' | 'google_health'
    providerUserId: text("provider_user_id"), // Fitbit user_id / Google sub
    accessTokenEnc: blob("access_token_enc").notNull(), // AES-GCM ciphertext
    refreshTokenEnc: blob("refresh_token_enc"), // AES-GCM ciphertext
    encIv: blob("enc_iv").notNull(), // per-row nonce (12 bytes)
    encTag: blob("enc_tag").notNull(), // GCM auth tag (16 bytes)
    expiresAt: integer("expires_at"), // epoch ms; cron refreshes before this
    scope: text("scope"), // granted scopes
    connectedAt: integer("connected_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("provider_accounts_user_provider").on(t.userId, t.provider)],
);

/* -------------------------------------------------------------------------- */
/* 2.3 app_sessions — opaque session tokens (our auth); only the hash stored   */
/* -------------------------------------------------------------------------- */

export const appSessions = sqliteTable("app_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the opaque token
  transport: text("transport").notNull(), // 'cookie' (web) | 'bearer' (iOS)
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at"),
  revokedAt: integer("revoked_at"),
});

/* -------------------------------------------------------------------------- */
/* 2.4 cached_metrics — durable, day-grained provider read cache              */
/* (intraday HR series are NOT stored here — TTL Map only)                    */
/* -------------------------------------------------------------------------- */

export const cachedMetrics = sqliteTable(
  "cached_metrics",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    // 'daily_activity' | 'sleep' | 'hr_day' | 'weight' | 'hrv' | 'breathing'
    // | 'spo2' | 'skin_temp' | 'cardio_score'
    kind: text("kind").notNull(),
    metricDate: text("metric_date").notNull(), // YYYY-MM-DD
    payload: text("payload").notNull(), // JSON: the normalized provider type
    fetchedAt: integer("fetched_at").notNull(), // for TTL eviction
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.provider, t.kind, t.metricDate] }),
  ],
);

/* -------------------------------------------------------------------------- */
/* 2.5 daily_scores — derived WHOOP-style daily snapshots (system of record)  */
/* -------------------------------------------------------------------------- */

export const dailyScores = sqliteTable(
  "daily_scores",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    date: text("date").notNull(), // YYYY-MM-DD
    // Recovery (gated on HRV availability)
    recovery: real("recovery"), // 0–100
    recoveryComponents: text("recovery_components"), // JSON {hrvZ,rhrZ,brZ,sleepZ}
    // Strain
    strain: real("strain"), // 0–21, self-calibrated to 90-day TRIMP distn
    trimp: real("trimp"), // raw Banister TRIMP before log-map
    // HRV
    hrvRmssd: real("hrv_rmssd"), // nightly RMSSD (ms)
    hrvLnEwma: real("hrv_ln_ewma"), // EWMA of ln(RMSSD) — rolling baseline
    hrvBandLow: real("hrv_band_low"), // baseline − 0.75σ
    hrvBandHigh: real("hrv_band_high"), // baseline + 0.75σ
    // Vitals
    restingHr: integer("resting_hr"),
    breathingRate: real("breathing_rate"),
    spo2: real("spo2"),
    skinTempDev: real("skin_temp_dev"), // deviation from baseline
    // Sleep
    sleepAsleepMin: integer("sleep_asleep_min"),
    sleepInBedMin: integer("sleep_in_bed_min"),
    sleepEfficiency: integer("sleep_efficiency"),
    sleepStages: text("sleep_stages"), // JSON {deep,light,rem,wake}
    sleepNeedMin: integer("sleep_need_min"), // baseline + debt + strain adj
    sleepNeedBreakdown: text("sleep_need_breakdown"), // JSON, α/β shown
    sleepPerformance: real("sleep_performance"), // asleep ÷ need, 0–100
    sleepDebtMin: integer("sleep_debt_min"), // decaying 5-night accumulator
    // Energy / fitness
    caloriesOut: integer("calories_out"),
    vo2max: real("vo2max"), // provider Cardio Fitness Score
    fitnessAge: real("fitness_age"), // VO2max-vs-norms (HUNT)
    stressEstimate: real("stress_estimate"), // HR-arousal derived
    computedAt: integer("computed_at").notNull(), // when the job last wrote this
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

/* -------------------------------------------------------------------------- */
/* 2.6 exercise_sessions — per-workout detail with HR                         */
/* -------------------------------------------------------------------------- */

export const exerciseSessions = sqliteTable(
  "exercise_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(), // provider log id
    logType: text("log_type").notNull(), // 'auto_detected' | 'manual' | 'pushed'
    activity: text("activity").notNull(), // walk/run/etc.
    startAt: integer("start_at").notNull(), // epoch ms
    durationSec: integer("duration_sec").notNull(),
    distanceM: real("distance_m"),
    calories: integer("calories"),
    avgHr: integer("avg_hr"),
    maxHr: integer("max_hr"),
    hrZones: text("hr_zones"), // JSON: HeartRateZone[]
  },
  (t) => [
    uniqueIndex("exercise_sessions_user_provider_external").on(
      t.userId,
      t.provider,
      t.externalId,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* 2.7 pushed_activities — push-walk dedupe ledger (the Fitbit dedupe ledger) */
/* -------------------------------------------------------------------------- */

export const pushedActivities = sqliteTable(
  "pushed_activities",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    sourceId: text("source_id").notNull(), // KS Fit session id (ActivityLogInput.sourceId)
    externalId: text("external_id"), // provider's id for the created log
    pushedAt: integer("pushed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider, t.sourceId] })],
);

/* -------------------------------------------------------------------------- */
/* 2.8 coach_conversations + coach_messages — AI memory                       */
/* -------------------------------------------------------------------------- */

export const coachConversations = sqliteTable("coach_conversations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const coachMessages = sqliteTable("coach_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => coachConversations.id),
  role: text("role").notNull(), // 'user' | 'assistant' | 'tool'
  // JSON: ModelMessage parts (text + tool-call + tool-result) so message-level
  // prompt caching works and citations stay auditable on reload.
  content: text("content").notNull(),
  // JSON: AI SDK tool-call parts, surfaced separately for inspection/citation.
  toolCallsJson: text("tool_calls_json"),
  tokenUsage: text("token_usage"), // JSON, for cost tracking
  createdAt: integer("created_at").notNull(),
});

/* -------------------------------------------------------------------------- */
/* 2.9 push_subscriptions — Web Push (VAPID) now, APNs later                   */
/* -------------------------------------------------------------------------- */

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  kind: text("kind").notNull(), // 'web' (VAPID) | 'apns' (iOS)
  endpoint: text("endpoint").notNull(), // Web Push URL / APNs device token
  keysJson: text("keys_json"), // JSON {p256dh, auth} for Web Push
  createdAt: integer("created_at").notNull(),
  lastSeen: integer("last_seen"),
  revokedAt: integer("revoked_at"),
});
