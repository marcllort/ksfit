# Stride — Feature Specifications

> Detailed, build-ready specs for every WHOOP-style feature. For each feature: **data inputs** (mapped to the `HealthProvider` seam in `packages/health-core`), the **exact formula/heuristic** to compute it, a **UI/UX sketch**, and an **honest approximation note** that draws the line between data we have and proprietary scores we are emulating.
>
> Companion docs: [00-OVERVIEW](./00-OVERVIEW.md) (decisions, feasibility matrix, roadmap).
>
> **Two hard prerequisites** referenced throughout:
> - **P1 — extend the provider seam.** Add `getHrv`, `getBreathingRate`, `getSpo2`, `getSkinTemp`, `getCardioScore` to `HealthProvider` (`web/src/lib/health/types.ts` → `packages/health-core`). All available on Fitbit now; on the Google Health roadmap.
> - **P2 — capture profile.** Add `age` (or DOB), `sex`, `heightCm`, `waistCm` to the user profile. Required for HRmax, fitness age, and norm tables.
>
> **Foundational conventions used by every metric below.**
> - **Personal baselines, not population targets.** All "where should I be" bands are computed from the *user's own* history via EWMA, never from a fabricated absolute ideal.
> - **EWMA(x, λ):** exponentially weighted moving average, `s_t = λ·x_t + (1−λ)·s_{t−1}`. We use a span notation: "EWMA over N nights" ⇒ `λ = 2/(N+1)`.
> - **z-score:** `z = (x − μ) / σ`, where μ and σ are the EWMA mean and EWMA standard deviation of the same series over the stated window. Clamp z to `[−3, +3]` before use.
> - **Snapshot, not on-the-fly.** Phase-3 derivation jobs compute these nightly and write a row per day into `daily_metrics` (`packages/db`); the API and coach read snapshots. Raw provider reads stay behind the fail-soft `fetchers` (see `web/src/lib/health/fetchers.ts`).
> - **Honest labelling rule.** Any metric we derive (rather than read directly) carries a visible `(Stride estimate)` / `(HR-based estimate)` tag and a one-tap "How is this computed?" explainer. We never claim WHOOP/Oura parity.
> - **Provenance shape.** Every derived value is stored and surfaced as `{ value, unit, asOf, source, components? }` so the UI and the coach can cite it.

---

## Table of contents

1. [Recovery score](#1-recovery-score)
2. [Day Strain](#2-day-strain)
3. [Sleep dashboard + sleep debt + recommendations](#3-sleep-dashboard--sleep-debt--recommendations)
4. [HRV baseline + target band](#4-hrv-baseline--target-band)
5. [Stress monitor](#5-stress-monitor)
6. [Fitness age / pace-of-aging](#6-fitness-age--pace-of-aging)
7. [Daily calories](#7-daily-calories)
8. [Per-exercise detail with HR](#8-per-exercise-detail-with-hr)
9. [Fitbit-detected (SmartTrack) workouts](#9-fitbit-detected-smarttrack-workouts)
10. [Weekly weight reminder / notification](#10-weekly-weight-reminder--notification)
11. [Health warnings](#11-health-warnings)
12. [Notification mechanism: web (PWA push) vs iOS (native push)](#12-notification-mechanism-web-pwa-push-vs-ios-native-push)

---

## 1. Recovery score

**One-liner.** A 0–100 "how ready is your body today" score, computed each morning from how far your overnight physiology sits above or below *your own* baseline.

### Data inputs
| Signal | Provider call (P1) | Window |
|---|---|---|
| Overnight HRV (RMSSD) | `getHrv(date)` | last night + 30-night baseline |
| Resting heart rate | `getHeartRateForDay(date,false).restingHr` | last night + 30-night baseline |
| Breathing rate | `getBreathingRate(date)` | last night + 30-night baseline |
| Sleep performance | derived (see §3) | last night |

### Formula / heuristic
Each input becomes a **z-score against its own 30-night EWMA baseline** (`λ = 2/31`), with sign oriented so "better recovery → higher":

```
z_hrv   = +zscore(rmssd)            // higher HRV = better
z_rhr   = −zscore(restingHr)        // lower RHR = better
z_br    = −zscore(breathingRate)    // lower/stable BR = better
z_sleep = (sleepPerformance − 100) / 15   // pseudo-z from §3, capped to [−3,+3]
```

Weighted blend (weights are **ours**, tunable, stored in settings):

```
S = w_hrv·z_hrv + w_rhr·z_rhr + w_br·z_br + w_sleep·z_sleep
    w_hrv = 0.50, w_rhr = 0.25, w_br = 0.10, w_sleep = 0.15

recovery = round( 100 · Φ(S) )      // Φ = standard normal CDF, maps S→(0,1)
```

Using Φ (the logistic/normal CDF) keeps the output in 0–100 and means "score 50 = exactly at your baseline." Band labels: **Green ≥ 67, Yellow 34–66, Red ≤ 33** (WHOOP-style traffic light; thresholds ours).

**Gate:** if fewer than ~14 nights of HRV exist, or HRV is unavailable for the target night, **do not show a Recovery score.** Instead show the available components (RHR vs baseline, sleep performance) with a "Recovery unlocks after ~2 weeks of HRV data" note. HRV is a hard prerequisite — without it this is not honestly a recovery score.

### UI / UX sketch
- **Top of dashboard:** large colored ring (green/yellow/red) with the number, label "Recovery (Stride estimate)", and "as of HH:MM".
- **Component breakdown** (expandable): four horizontal diverging bars (HRV, RHR, Breathing, Sleep), each showing today's value, the 30-night baseline, and the z contribution. Makes the score legible, not magic.
- **7/30-day trend** sparkline beneath the ring.
- Coach hook: tapping the ring offers "Ask the coach why" → `/v1/coach/chat` with the snapshot.

### Honest approximation note
WHOOP's Recovery is a proprietary model (HRV-dominant, with RHR/respiratory/sleep) trained on labelled data we don't have. **This is a transparent re-implementation, not parity.** The weights are our defaults, surfaced and editable. We label it **"Recovery (Stride estimate)"** and always show components so the user can audit it. Because it is HRV-gated, we never produce a "recovery" number from RHR alone and call it recovery.

---

## 2. Day Strain

**One-liner.** A 0–21 cardiovascular load score for the day, scaled to *your own* recent range, built from time spent in each heart-rate zone.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Intraday HR (1-min) | `getHeartRateForDay(date,true).intraday` | the load signal |
| Resting HR | `getHeartRateForDay(date,false).restingHr` | HRR floor |
| HRmax | from profile `age` (P2) | `HRmax = 208 − 0.7·age` (Tanaka) |

### Formula / heuristic
Use **Banister TRIMP with the Heart-Rate Reserve (HRR) exponential weighting**, summed per minute:

```
HRR(t) = ( HR(t) − HRrest ) / ( HRmax − HRrest )          // clamp to [0,1]
y      = HRR(t)
w(t)   = y · 0.64 · e^(1.92·y)        // male; female: 0.86 · e^(1.67·y)  (Banister)
TRIMP  = Σ_minutes  Δt_min · w(t)      // Δt in minutes (1 for 1-min samples)
```

Then **log-map TRIMP to 0–21, self-calibrated** to the user's own 90-day distribution so the scale is personally meaningful:

```
L      = ln(1 + TRIMP)
L_p95  = 95th percentile of L over the trailing 90 days   // the user's "all-out" reference
strain = 21 · clamp( L / L_p95 , 0, 1 )
```

Until ~14 days of history exist, fall back to a fixed reference (`L_p95 = ln(1 + 300)`) and tag the value "calibrating".

### UI / UX sketch
- **Day Strain ring/gauge 0–21** next to Recovery, with the number and a "vs your 30-day avg" delta.
- **Zone-minutes stacked bar** for the day (Fat Burn / Cardio / Peak) driving the score.
- **Strain-vs-Recovery scatter** for the week: visualizes "did I overreach on a low-recovery day?" — the core WHOOP feedback loop.

### Honest approximation note
WHOOP Strain is a proprietary 0–21 logarithmic scale over cardiovascular load; we reproduce the *shape* (TRIMP → log → 0–21) but the **calibration is to the user's own distribution, not WHOOP's population curve.** A "14" here is *not* comparable to a friend's WHOOP "14" — it means "high relative to your own 90 days." Labelled **"Day Strain (Stride estimate)"**. Accuracy depends on intraday HR density; on days with sparse HR it is under-counted — we surface a coverage indicator.

---

## 3. Sleep dashboard + sleep debt + recommendations

**One-liner.** Direct sleep-stage data, plus a **Sleep Need / Sleep Performance** model and a decaying **sleep-debt** accumulator with plain-language recommendations.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Asleep / in-bed / efficiency | `getSleep(date)` → `asleepMin, inBedMin, efficiency` | direct |
| Stages (deep/light/rem/wake) | `getSleep(date).stages` | direct, minutes |
| Day Strain (prior day) | §2 | drives need |
| Sleep debt (running) | derived | feeds need |

### Formulas / heuristics

**Sleep dashboard** is **direct data** — no derivation. Show asleep, in-bed, efficiency, and the four-stage breakdown. Compare stage **percentages** against age-normal reference ranges (e.g. deep ~13–23%, REM ~20–25% of total sleep for adults) as context bands.

**Sleep Need (dynamic):**
```
need = baselineNeed + debtComponent + strainComponent − napCredit
  baselineNeed   = personal EWMA of asleepMin on well-rested nights, init 480 min (8h)
  debtComponent  = α · currentSleepDebt          α = 0.50   (recover half the debt)
  strainComponent= β · max(0, strain − 10)·6 min β = 1.0    (~6 min extra per strain pt over 10)
  napCredit      = today's logged nap minutes
```
All coefficients (α, β, the 6-min slope) are **ours**, shown in the explainer.

**Sleep Performance:**
```
sleepPerformance = round( 100 · asleepMin / need )   // capped display at 100
```

**Sleep debt** — decaying 5-night accumulator:
```
nightlyShortfall(d) = max(0, need(d) − asleepMin(d))
debt = Σ_{i=0..4}  decay^i · nightlyShortfall(d − i)     decay = 0.5
```
So last night counts full, the night before half, etc. Reported as **"Est. sleep debt (5 nights)"** in minutes/hours.

**Recommendations** (rule-based, deterministic — *not* the LLM):
- `sleepPerformance < 70` → "You're ~Xh short. Aim for bed by HH:MM tonight" (HH:MM = desired wake − need).
- `debt > 60 min` → "Carrying ~Xh of sleep debt; add 30–45 min for the next 2 nights."
- `efficiency < 85%` and `wake%` high → "Time in bed is fine but fragmented — consider wind-down routine."
- Stage outliers vs age-normal bands → contextual note (never a diagnosis; see §11).

### UI / UX sketch
- **Sleep card:** hypnogram-style stacked stage timeline for the night; ring for Sleep Performance %.
- **Need breakdown:** itemized list (baseline + debt + strain − nap = need) so the target is transparent.
- **Sleep-debt gauge** with 5-night contribution bars.
- **"Tonight" recommendation banner** with a suggested bedtime; optional → triggers a wind-down reminder (§12).

### Honest approximation note
Stage data and efficiency are **direct** from the provider — no approximation. **Sleep Need / Performance / debt are our model**, in the spirit of WHOOP's Sleep Need but with our own coefficients (α, β, decay), all surfaced. Stage % comparisons use published age-normal ranges as *context*, not as a clinical judgement. The recommendation engine is deterministic rules, kept separate from the AI coach so advice is auditable.

---

## 4. HRV baseline + target band

**One-liner.** Your nightly HRV plotted against a personal band; the band *is* the target — rising baseline is the goal, not hitting a fabricated number.

### Data inputs
| Signal | Provider call (P1) | Window |
|---|---|---|
| Nightly RMSSD | `getHrv(date)` | 30-night |

### Formula / heuristic
Work in **log space** (RMSSD is right-skewed):
```
x_t      = ln(rmssd_t)
μ_t      = EWMA(x_t, span 30)                  // λ = 2/31
σ_t      = sqrt( EWMA( (x_t − μ_t)^2 , span 30) )
bandLow  = exp( μ_t − 0.75·σ_t )
bandHigh = exp( μ_t + 0.75·σ_t )
baseline = exp( μ_t )
status   = below | within | above   (vs today's rmssd)
```
"Where should I be" = **inside your own band**. "How to get there": deterministic guidance tied to inputs that move HRV (sleep consistency, alcohol, late strain, hydration) — surfaced as tips, and as coach context, **never as a fabricated absolute HRV target.**

### UI / UX sketch
- **30-night line chart:** RMSSD line over a shaded ±0.75σ band; baseline center line; today's point highlighted (green inside / amber outside).
- **Trend chips:** "Baseline ↑ 4ms over 30d" — the real signal.
- Explainer: "Your band is personal. A good day is one inside the band; progress is the band itself trending up."

### Honest approximation note
HRV (RMSSD) is **direct sensor data** once §P1 lands; the **band is a transparent statistic of your own history**, not a population norm. We deliberately do **not** display a single "ideal HRV" number — that would be fabrication, since healthy HRV varies enormously by individual and age. Requires the provider HRV wiring (Fitbit exposes nightly RMSSD now; gate until present).

---

## 5. Stress monitor

**One-liner.** A daytime "physiological arousal" estimate from how elevated your HR runs above resting, with exercise excluded.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Intraday HR | `getHeartRateForDay(date,true).intraday` | the arousal signal |
| Resting HR | `getHeartRateForDay(date,false).restingHr` | floor |
| Workout windows | §8 / SmartTrack §9 | to exclude exercise minutes |
| (optional) intraday HRV | `getHrv` intraday if available | refines estimate |

### Formula / heuristic
For each non-exercise, awake minute compute HR elevation over resting, normalized by reserve:
```
arousal(t) = clamp( ( HR(t) − HRrest ) / (HRmax − HRrest), 0, 1 )   // exercise minutes removed
stressMin  = % of awake non-exercise minutes with arousal > 0.30
stressIdx  = 100 · mean( arousal over awake non-exercise minutes )   // 0–100 day index
```
Bucket into **Low / Medium / High** by the user's own trailing-30-day terciles (self-calibrated). Optional HRV refinement: blend in `−zscore(intradayHRV)` when present.

### UI / UX sketch
- **Daytime stress ribbon:** a horizontal time-of-day strip colored low→high, with exercise periods hatched out and labelled "excluded".
- **Day stress index** number + bucket, "vs your typical day".
- Clear caption: **"HR-based estimate of physiological arousal — not an emotional or clinical stress measure."**

### Honest approximation note
**Neither the Fitbit Web API nor the Google Health API exposes EDA / a Stress Management Score.** This is **fully self-derived from HR elevation** and is the **most fabrication-prone metric in the app.** We label it **"Stress (HR-based estimate)"**, keep claims modest (arousal, not emotion), exclude exercise, and never imply it is a validated stress score. It is intentionally coarse (Low/Med/High vs the user's own baseline).

---

## 6. Fitness age / pace-of-aging

**One-liner.** A cardiorespiratory "fitness age" from your VO2max compared against age/sex norm tables.

### Data inputs
| Signal | Provider call (P1) / profile | Notes |
|---|---|---|
| Cardio Fitness Score (VO2max) | `getCardioScore(date)` | preferred input |
| Age, sex | profile (P2) | for norm lookup |
| Height, waist, resting HR | profile + HR | for the non-exercise fallback only |

### Formula / heuristic
**Primary (device VO2max + norms):** look up the **age at which the user's VO2max equals the population median (50th percentile) for their sex.** That mapped age is the fitness age.
```
fitnessAge = age such that  VO2max_user == median_VO2max(age, sex)   // from a sex-specific norm table
paceOfAging = fitnessAge − chronologicalAge    // negative = "younger than your years"
```

**Fallback (no device VO2max) — non-exercise regression (HUNT / Nes 2011):** estimate VO2max from sex, age, waist, resting HR, and physical-activity index, then map as above.
> ⚠️ **VERIFY BEFORE HARDCODING.** The Nes 2011 (HUNT) non-exercise VO2max coefficients are **unverified** in our research. Pull the exact regression coefficients from the **primary paper** before implementing the fallback. Prefer the device VO2max path wherever available; only use the regression when `getCardioScore` is empty, and label it "rough estimate".

### UI / UX sketch
- **Headline:** "Fitness age: 34 (you are 41)" with a delta chip "−7 yrs (cardiorespiratory)".
- **VO2max-vs-norms curve** with the user's point and the median line.
- Trend over time = the "pace of aging" analogue (is fitness age moving the right way?).

### Honest approximation note
This is **"Fitness Age (cardiorespiratory)" — explicitly NOT biological/epigenetic age** and not WHOOP's "pace of aging" (which uses different inputs). It is a VO2max-vs-norms mapping (HUNT method). Device VO2max itself is an estimate from the provider. The non-exercise fallback is an estimate of an estimate — clearly tagged, and **blocked until the HUNT coefficients are verified from the source.**

---

## 7. Daily calories

**One-liner.** Total and active energy burned per day, read directly.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Calories out | `getDailyActivity(date).caloriesOut` | total daily energy |
| Active minutes / steps / distance | `getDailyActivity(date)` | context |
| (Google) Active Energy Burned | `getDailyActivity` mapped | split out where available |

### Formula / heuristic
**Direct passthrough.** Total = provider `caloriesOut`. Where the provider distinguishes (Google `Total Calories` vs `Active Energy Burned`; Fitbit activity summary), show **active vs basal (BMR)** split:
```
activeCalories = caloriesOut − estimatedBMR     // when active energy not provided directly
```
BMR estimate via Mifflin–St Jeor from profile (P2) only if the provider doesn't supply the split; otherwise use provider values verbatim.

### UI / UX sketch
- **Daily calories card:** big total, with an active/basal donut, steps + distance + active minutes underneath.
- **7-day bar chart**, optional "vs goal" line if a goal is set.

### Honest approximation note
**Direct data** — no proprietary modelling. The only derived element is the active/basal split *when* the provider doesn't supply it (Mifflin–St Jeor BMR), which we tag as estimated. Calorie figures are inherently device estimates; we don't add error on top.

---

## 8. Per-exercise detail with HR

**One-liner.** Each logged workout with duration, HR zones, average/peak HR, and an HR curve overlay.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Workout list (avgHR, zones, minutes, calories) | Fitbit `activities/list` → new `getExercises(from,to)` (P1) | per-session summary |
| Intraday HR for the session window | `getHeartRateForDay(date,true)` sliced to start..end | the overlay |
| (Google) Exercise session + correlated Heart Rate | `GoogleHealthProvider.getExercises` | Sample granularity HR |

> Provider extension: add `getExercises(from,to): Promise<ExerciseSession[]>` to `HealthProvider`, where `ExerciseSession = { sourceId, type, start, durationSec, avgHr, peakHr, zones: HeartRateZone[], calories, logType }`. Reuses the existing `HeartRateZone` type.

### Formula / heuristic
Mostly **direct**. Derived extras:
- **HR overlay:** slice `intraday` to `[start, start+duration]`, render as a line.
- **Time-in-zone:** prefer provider `zones`; else recompute from the intraday slice using the same zone cuts as §2 (Tanaka HRmax from profile).
- **Per-session TRIMP** (same Banister formula as §2) so each workout has a comparable load number.

### UI / UX sketch
- **Session list** (date, type, duration, avg HR, calories, a SmartTrack badge if auto-detected — see §9).
- **Session detail:** HR-curve overlay (this already exists for treadmill sessions today — reuse it), zone-minutes bar, avg/peak HR, TRIMP, calories.

### Honest approximation note
Summaries and zones are **direct** from the provider. Recomputed time-in-zone (fallback) and per-session TRIMP are clearly our derivations. **Google migration caveat:** Google `Heart Rate` is **Sample granularity**, not a named intraday stream — during Phase 4 we must **validate sample density is sufficient for the HR overlay** before cutover; if sparse, the overlay degrades to summary-only with a note.

---

## 9. Fitbit-detected (SmartTrack) workouts

**One-liner.** Surface workouts Fitbit auto-detected (SmartTrack), distinguished from manually logged ones.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Activity list with `logType` | Fitbit `activities/list` → `getExercises` (§8) | `logType = "auto_detected"` marks SmartTrack |

### Formula / heuristic
**Direct.** Filter/flag `ExerciseSession.logType === "auto_detected"`. No computation; these flow through the §8 detail view with a badge. Used by the §5 stress monitor and §2 strain to mark exercise windows.

### UI / UX sketch
- **"Auto-detected" badge** on session rows and detail.
- Optional filter toggle: "All / Manual / Auto-detected".

### Honest approximation note
**Direct data** — SmartTrack detection is Fitbit's; we only read and label it. On Google migration, map to the equivalent auto-detected flag on the `Exercise` session if present; if Google doesn't expose the distinction, drop the badge rather than guess.

---

## 10. Weekly weight reminder / notification

**One-liner.** If your last weight reading is stale (>7 days), nudge you to weigh in — via web push now, native push on iOS later.

### Data inputs
| Signal | Provider call | Notes |
|---|---|---|
| Weight readings | `getWeightLog(from,to)` | staleness check |
| Push subscription(s) | `packages/db` `push_subscription` table | web (VAPID) + iOS (APNs) |
| Reminder schedule/prefs | settings | day-of-week, opt-out |

### Formula / heuristic
A **backend cron** (Phase 3) runs daily:
```
latest = max(t) over getWeightLog(last 30d)
if (now − latest) > 7 days  AND  today == user's reminderDay  AND  not already nudged this week:
    enqueue push to all active subscriptions for the user
    write a row to a notification ledger (dedupe — one nudge per week)
```
Optional weight-trend context in the payload: EWMA(weightKg, span 7) and 30-day delta, so the notification can say "you're trending −0.4 kg/wk".

### UI / UX sketch
- **Push notification:** "Weekly weigh-in — last reading was 9 days ago. Tap to log." Deep-links to the weight tab.
- **In-app banner** fallback (if push not granted): the same nudge on the dashboard.
- **Settings:** choose reminder day, enable/disable, manage device subscriptions.

### Honest approximation note
Entirely **direct/operational** — no derived health number, just a staleness check + dedupe ledger. The only computed extra (weight trend) is a plain EWMA, labelled as such. Weight write-back (logging a new reading) is also direct (`Fitbit Body` / Google `Weight` writable).

---

## 11. Health warnings

**One-liner.** Conservative, rule-based flags for out-of-range physiology — *context, never diagnosis* — plus mandatory escalation language.

### Data inputs
All metrics above (HRV, RHR, breathing rate, SpO2, skin temp via P1; sleep; stress). SpO2 and skin temp are read where the provider exposes them.

### Formula / heuristic
Deterministic threshold rules over the personal baselines (examples — all tunable, all shown):
```
- restingHr   > baseline + 2σ for ≥3 consecutive nights      → "RHR elevated vs your baseline"
- rmssd       < baseline − 2σ for ≥3 consecutive nights      → "HRV suppressed vs your baseline"
- breathingRate elevated + SpO2 dip + skin-temp rise together → "Multiple overnight signals off-baseline" (illness-onset pattern)
- SpO2 nightly average < 90%                                  → flagged with strong escalation copy
```
The combined breathing+SpO2+temp pattern is the classic "you might be getting sick" early-warning cluster; we present it as a **pattern observation**, not a verdict.

**Escalation rules (non-negotiable):**
- Every warning carries: *"This is not medical advice. If you feel unwell or this persists, consult a clinician."*
- Symptom inputs to the **AI coach** (chest pain, fainting, severe SOB, etc.) trigger an immediate **"seek medical care / emergency services"** response and **halt** normal coaching (see coach guardrails in the overview).
- No warning ever names a disease or prescribes treatment.

### UI / UX sketch
- **Subtle, dismissible info cards** (amber, not red-alarm) at the top of the relevant dashboard: "Heads up: your resting HR has been ~6 bpm above baseline for 3 nights."
- Always paired with the disclaimer line and a "what could affect this?" explainer (sleep, alcohol, illness, training load).

### Honest approximation note
These are **pattern flags over the user's own baselines**, not clinical screening. SpO2/skin-temp depend on P1 wiring and device support (Fitbit exposes both; validate on Google during Phase 4). We deliberately bias toward **under-warning** and toward **"see a clinician"** rather than implying diagnostic capability. This feature is where the medical-safety guardrails are most load-bearing.

---

## 12. Notification mechanism: web (PWA push) vs iOS (native push)

Both transports key off **one `push_subscription` table** in `packages/db` (columns: `userId`, `platform` `'web'|'ios'`, `endpoint`/`token`, `keys` (web p256dh/auth), `createdAt`, `lastSeen`, `revoked`). The backend cron (§10, and any future nudges) enqueues a logical notification; a dispatcher fans out per platform.

### Web — PWA Web Push (VAPID)
- **Service worker** (`apps/web`, e.g. `public/sw.js`) registered on first load; a `push` event handler calls `self.registration.showNotification(...)`, and a `notificationclick` handler deep-links into the app.
- **Subscription:** request `Notification.permission`, then `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public key> })`; POST the `PushSubscription` (endpoint + p256dh + auth keys) to `POST /v1/push/subscriptions`.
- **Server send:** backend uses VAPID keys (`web-push` library) to POST encrypted payloads to each subscription endpoint. Keys: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in backend env.
- **App manifest** (`manifest.webmanifest`) makes the web app installable as a PWA so push works as an installed app.
- ⚠️ **LAN/HTTPS caveat — must verify:** Web Push requires a **secure context**. The setup is `treadmill.home` behind Caddy with **trusted local HTTPS**, so this *should* work, but **confirm during Phase 3** that the browser accepts the cert for service-worker registration and push subscription on the LAN hostname. iOS Safari additionally only supports Web Push for **installed (Add to Home Screen) PWAs** — which is moot once the native app ships, but relevant if testing push on an iPhone before Phase 5.

### iOS — native push (APNs) — Phase 5
- The native app registers for remote notifications, obtains an **APNs device token**, and POSTs it to the same `POST /v1/push/subscriptions` with `platform: 'ios'`.
- Backend dispatcher sends to APNs (token-based auth, `.p8` key) for iOS rows and Web Push for web rows — **same notification, two senders.**
- **Zero new backend contract work:** the endpoint and table already exist from Phase 3; Phase 5 only adds the APNs sender branch and the iOS client registration.

### Dedupe & scheduling
- All sends go through a **notification ledger** (one weekly weigh-in nudge per user per week; idempotent by `(userId, notificationType, isoWeek)`), so re-runs of the cron or multiple devices never double-notify.
- Cron lives in the backend (Phase 3), off the request path, alongside the token-refresh job.

---

*Cross-references:* the provider seam is `web/src/lib/health/types.ts` (→ `packages/health-core`); fail-soft reads are `web/src/lib/health/fetchers.ts`; derived metrics are computed by Phase-3 nightly jobs and stored in `packages/db` `daily_metrics`; the AI coach reads these snapshots/tools and never recomputes a health value itself.
