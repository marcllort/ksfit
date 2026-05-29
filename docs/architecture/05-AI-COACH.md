# 05 — AI Coach Design

**Status:** Proposed (authoritative target). **Date:** 2026-05-29.
**Scope:** The AI coach/trainer for Stride — a WHOOP-style health assistant that interprets the user's real metrics, answers questions, and gives bounded, cited guidance. It runs entirely in the backend (`apps/backend`), streams to the web app now and the iOS app later, and is grounded in deterministically-computed numbers it never invents.

This document depends on the split defined in [01-ARCHITECTURE.md](./01-ARCHITECTURE.md). The coach is **Phase 3** work — it ships only after the database (Phase 2) and the derived-metrics jobs (early Phase 3) exist, because the coach is a thin interpretive layer over data those phases produce.

---

## 1. Guiding principles

1. **The model interprets; the backend computes.** Every health number the coach states comes from a tool call or the daily snapshot — both produced by deterministic server code (`packages/health-core/metrics`). The model is forbidden from doing arithmetic on health data or inventing a value. This is principle #4 of the architecture, made concrete.
2. **Every number is cited.** Tool results carry `{value, unit, asOf, source}`. The coach must attribute each figure to its source and freshness, so the user can tell "your HRV last night was 42 ms (Fitbit, 2026-05-29)" from a hallucination.
3. **It is a coach, not a clinician.** No diagnosis, no prescription, no dosing. Medical-symptom inputs are escalated to "see a professional." A short disclaimer is appended to advice.
4. **Per-user scoping is enforced server-side.** The coach's tools resolve data for the *authenticated session's* user only. A client-supplied user id is never trusted.
5. **Bounded and cheap.** The agentic loop is capped (`stepCountIs(6)`); the system prompt + tool defs + daily snapshot are prompt-cached so each turn pays the cache-read price, not the full re-encode.

---

## 2. Stack: Vercel AI SDK + Anthropic Claude

We use the **Vercel AI SDK** (the user named it) with the **`@ai-sdk/anthropic`** provider. The AI SDK gives us:

- One `streamText()` call that runs the tool-calling loop, streams tokens, and returns a typed result.
- `toUIMessageStreamResponse()` / `toTextStreamResponse()` for an SSE response the web client consumes with `@ai-sdk/react`'s `useChat`, and that iOS can consume as a raw SSE/text stream.
- Provider-agnostic tool definitions (`tool({ inputSchema, execute })`) with Zod schemas — the same Zod we already use for the OpenAPI contract.

**Model:** `claude-sonnet-4-6` for interactive chat (the plan's pinned choice — good interpretation quality at chat latency/cost). `claude-haiku-4-5` for cheap background briefings (the morning summary cron). Model IDs are pinned as bare strings; **do not append date suffixes**. Both run with **adaptive thinking** for non-trivial questions and a low/medium effort setting — the coach reasons over a handful of tool results, not a long agentic horizon.

> Provider note: the AI SDK's `anthropic(...)` provider wraps the same Messages API documented for `@anthropic-ai/sdk`. The thinking/effort/caching semantics below are Anthropic's; the AI SDK passes them through `providerOptions.anthropic`.

### 2.1 Where it lives

```
apps/backend/src/
  routes/
    coach.ts                 # POST /v1/coach/chat  (+ POST /v1/coach/briefing for the cron)
  lib/coach/
    model.ts                 # provider + model selection, thinking/effort, cache config
    systemPrompt.ts          # frozen system-prompt builder (no volatile data inside)
    tools.ts                 # tool definitions over packages/health-core fetchers + metrics
    context.ts               # builds the cache-marked daily snapshot block
    memory.ts                # conversation load/save against packages/db
    safety.ts                # symptom-escalation check + disclaimer text
```

The coach **wraps the existing `HealthProvider` fetchers** (`packages/health-core/src/fetchers.ts`) and the derived-metric readers (`packages/health-core/src/metrics`, surfaced as REST resources by Phase 3). It does not talk to Fitbit/Google directly — the provider seam stays the only door to third-party data, so when we cut over to Google Health the coach is unaffected.

---

## 3. Request flow

```
web useChat / iOS SSE client
        │  POST /v1/coach/chat  { messages: UIMessage[] }   (httpOnly cookie / Bearer)
        ▼
apps/backend  auth middleware ── resolves session → userId  (client-supplied ids ignored)
        │
        ▼
coach route:
  1. memory.load(userId, conversationId)         → prior ModelMessages
  2. context.buildSnapshot(userId)               → cache-marked daily snapshot block
  3. safety.precheck(latestUserText)             → if medical symptom, short-circuit to escalation
  4. streamText({
        model, system (frozen), messages (snapshot + history + new turn),
        tools (scoped to userId), stopWhen: stepCountIs(6),
        providerOptions.anthropic: { thinking: { type:'adaptive' }, cacheControl }
     })
  5. onFinish → memory.save(userId, conversationId, response.messages)
        │
        ▼
  toUIMessageStreamResponse()  → SSE back to the client
```

**Streaming to web:** `useChat` from `@ai-sdk/react` consumes the UI-message stream directly; tokens render as they arrive.
**Streaming to iOS (Phase 5):** the same endpoint; the Swift client reads the SSE stream. No new backend contract — the OpenAPI spec documents `/v1/coach/chat` as a streaming endpoint, and the Swift client treats it as a text/event-stream. This is why the coach must not depend on any web-only SDK helper for its core logic.

---

## 4. Tool definitions (grounding)

Tools are how the model gets real numbers. Each returns the **standard grounding envelope** so the model can cite:

```ts
type Grounded<T> = { value: T; unit: string; asOf: string /* ISO */; source: 'fitbit' | 'google' | 'ksfit' | 'derived' };
```

All `execute` functions close over the **authenticated `userId`** (captured when the route builds the tool set) — the model cannot pass a user id, and there is no parameter for one. Tools fail soft: if a metric is unavailable (e.g. HRV not wired, or provider disconnected) they return `{ available: false, reason }` rather than throwing, so the model can say "I don't have your HRV yet" instead of erroring.

| Tool | Wraps | Returns |
|---|---|---|
| `getRecovery(date?)` | `metrics/recovery` (gated on HRV availability) | score 0–100 + components (HRV/RHR/breathing/sleep z-scores), each grounded |
| `getStrain(date?)` | `metrics/strain` | day strain 0–21 (TRIMP→log-mapped, self-calibrated) |
| `getSleep(date?)` | `fetchers.getSleep` + `metrics/sleep` | asleep/in-bed/efficiency, stages, Sleep Need vs Performance, sleep debt |
| `getHrvTrend(days?)` | `metrics/hrv` | nightly RMSSD + EWMA baseline band (±0.75σ) — "where you are vs your target" |
| `getHeartRate(date?)` | `fetchers.getHeartRateForDay` | resting HR, zones; intraday summary on request |
| `getActivity(date?)` | `fetchers.getDailyActivity` | steps, distance, active minutes, calories |
| `getWeightTrend(days?)` | `fetchers.getWeightLog` | readings + trend + staleness flag (drives the weekly reminder) |
| `getStress(date?)` | `metrics/stress` | HR-based arousal estimate — **labelled "HR-based estimate"**, claims kept modest |
| `getFitnessAge()` | `metrics/fitnessAge` | cardiorespiratory fitness age (VO2max-vs-norms) — not biological age |
| `getProfile()` | `packages/db` profile repo | age/sex/height/waist (needed to contextualize the above) |

**Tool-input schemas use Zod** (`tool({ inputSchema: z.object({ date: z.string().date().optional() }), execute })`), reusing schemas from `packages/shared-types`. Date defaults to "today" server-side.

The model is instructed (system prompt) to **call a tool before stating any metric** and to never compute a derived figure itself — if it wants "recovery", it calls `getRecovery`, it does not average the components in its head.

---

## 5. System-prompt skeleton

The system prompt is **frozen** — it contains no dates, no user id, no metrics (those go in `messages` as the snapshot block, so the prompt prefix stays byte-identical and cacheable across turns). Skeleton:

```
You are Stride's health coach. You help one person understand their sleep,
recovery, strain, HRV, and activity, and you suggest concrete, gentle next steps.

GROUNDING (non-negotiable):
- Every health number you state MUST come from a tool result or the
  "Today's snapshot" block. Call the relevant tool before citing a metric.
- Never calculate, average, or estimate a health value yourself. If a tool
  returns {available:false}, say you don't have that data and why.
- Cite each figure with its value, unit, and date, e.g.
  "your resting HR was 54 bpm (2026-05-29)". Name the source if asked.
- Stride's scores (Recovery, Strain, Sleep Need, Stress, Fitness Age) are
  Stride's own estimates, not WHOOP/clinical values. Say so when relevant.
  "Stress" is an HR-based estimate of physiological arousal, not an emotion meter.

SCOPE & SAFETY:
- You are a coach, not a doctor. No diagnosis, no prescriptions, no dosing,
  no interpreting symptoms as conditions.
- If the user describes a medical symptom (chest pain, fainting, severe or
  persistent symptoms, mental-health crisis), stop coaching and advise them
  to contact a qualified professional / emergency services. Do not speculate.
- Keep advice modest and reversible (sleep, hydration, pacing, light vs hard
  days). Defer to a clinician for anything medical.

STYLE: concise, warm, specific. Lead with the answer. One or two next steps,
not a lecture.
```

The mandatory **disclaimer** (a single fixed sentence) is appended by `safety.ts` to any turn that contains advice — kept out of the model's free text so it's verbatim and can't be paraphrased away.

---

## 6. Prompt caching

The cached prefix is, in render order, **system prompt → tool definitions → the daily-snapshot block**. All three are stable within a session, so we cache-mark the snapshot block (the last stable element) and every subsequent turn in the conversation reads the cache instead of re-encoding ~thousands of tokens.

Two hard requirements (from the caching rules):

- **Minimum cacheable prefix is 2048 tokens for `claude-sonnet-4-6`.** The system prompt alone won't reach it, so we deliberately combine system + tool defs + snapshot into one prefix; if it's still short, that's fine — it just won't cache, no error. The snapshot is the main mass.
- **The snapshot carries the `cache_control` breakpoint, not a `UIMessage`.** `UIMessage`s from `useChat` don't carry provider options, so the coach **converts incoming `UIMessage`s to `ModelMessage`s** (`convertToModelMessages`) and injects the snapshot as a cache-marked `ModelMessage` ahead of the history. Per-turn volatile content (the new user question) goes *after* the breakpoint so it never invalidates the prefix.

Keep the prefix frozen: no `Date.now()`, no user id, no per-request UUID in the system prompt. The snapshot's own `asOf` timestamps live *inside* the cached block and are stable for the day; we re-warm/rebuild the snapshot when it rolls to a new day (or when a fresh sync lands), which intentionally writes a new cache entry.

Verify with `cache_read_input_tokens > 0` on the second turn of a conversation. If it's zero, a silent invalidator crept into the prefix.

---

## 7. Memory / conversation storage

Conversations persist in `packages/db` (the SQLite added in Phase 2), so the coach has continuity across page loads and, later, across web↔iOS.

```
coach_conversations(id, user_id, title, created_at, updated_at)
coach_messages(id, conversation_id, role, content_json, created_at)
```

- `content_json` stores AI SDK `ModelMessage` parts (text + tool calls + tool results), so a reload reconstructs the exact model-visible history — **not** just rendered text. Preserving tool-result parts keeps the citations grounded on the next turn.
- `memory.load` returns the prior `ModelMessage[]` for the conversation (scoped by `user_id`); `memory.save` runs in `streamText`'s `onFinish` with `response.messages`.
- **Trimming:** keep the full transcript in the DB; when the model-visible history grows large, cap what we send (e.g. last N turns) rather than truncating mid-message. We don't enable server-side compaction for the coach — sessions are short and the snapshot re-grounds every turn, so a sliding window is simpler and keeps the cached prefix intact.
- Snapshots themselves are **not** stored per-message; `context.buildSnapshot` reads the current daily-metrics rows at request time. This keeps the coach honest (always the latest numbers) and avoids stale figures baked into history.

---

## 8. Safety guardrails (non-negotiable)

These are enforced in code and prompt, layered:

1. **Grounded-in-real-numbers / no fabrication.** Numbers come only from tools or the snapshot; the system prompt forbids self-calculation; tools fail soft so "no data" is a first-class answer. Reinforced by the cite-the-source requirement — an uncited number is a prompt violation we can flag.
2. **No diagnosis / no prescription.** System prompt scopes the coach to lifestyle guidance; medical interpretation is out of bounds.
3. **Symptom escalation.** `safety.precheck` scans the incoming user turn for medical-symptom signals before the model runs; on a hit, the route short-circuits to a fixed escalation message (see a professional / emergency services) and does **not** invoke the model for advice. The system prompt repeats the rule as defense-in-depth for symptoms that surface mid-conversation.
4. **Mandatory disclaimer.** A fixed disclaimer sentence is appended verbatim by `safety.ts` to any advisory turn — not generated by the model, so it can't be reworded or dropped.
5. **Per-user tool scoping.** Tools close over the authenticated `userId`; there is no user-id parameter; the auth middleware is the sole source of identity. A client cannot make the coach read another user's data.
6. **Bounded loop.** `stopWhen: stepCountIs(6)` caps tool-call rounds so a misbehaving prompt can't run an unbounded loop. `maxOutputTokens` is set so a turn can't run away.
7. **Modest claims on soft metrics.** Stress (HR-based), Recovery, and Fitness Age are labelled as Stride estimates in both the tool envelope (`source: 'derived'`) and the system prompt; the coach must not present them as clinical or WHOOP-parity values.

---

## 9. Open items / dependencies

- **Hard dependency on Phase 3 metrics.** `getRecovery` and `getHrvTrend` are gated on HRV being wired (the architecture's prerequisite). Until then those tools return `{available:false}` and the coach honestly says recovery isn't computable yet — ship the coach with the tools that *do* have data and let the others light up as metrics land.
- **Model pinning vs the skill default.** The synthesized plan pins `claude-sonnet-4-6` for the coach; that is the authoritative choice here for chat cost/latency. If we later want maximum interpretation quality we can revisit the Opus tier — that's a one-line change in `model.ts`.
- **Briefing cron** (`/v1/coach/briefing`, `claude-haiku-4-5`) reuses the same tools and snapshot to produce the morning summary and the weekly weight reminder copy; it writes a notification rather than streaming.

---

Relevant existing files this design builds on: `/home/mac12llm/ksfit/web/src/lib/health/fetchers.ts` (tools wrap these), `/home/mac12llm/ksfit/web/src/lib/health/types.ts` (the `HealthProvider` seam the tools sit behind), and `/home/mac12llm/ksfit/docs/architecture/01-ARCHITECTURE.md` (the backend/frontend split and the `lib/coach/*` layout). The metric derivations the tools read are Phase 3 work in `packages/health-core/src/metrics`.
