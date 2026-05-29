# Stride (ksfit fork) — Roadmap & Improvement Plan

> Generated from a multi-dimension audit (security, code quality, API surface, UI/UX, deployment) of this fork.
> Goal: make this the best possible self-hosted, single-user, LAN-only KS Fit / WalkingPad dashboard.
> Security findings here were **adversarially verified** — refuted/inapplicable findings are excluded.

**Deployment target:** LAN-only, hostname `treadmill.home`, trusted local HTTPS (no browser warnings), on a UniFi network.

---

## Status legend
- ✅ done
- 🔜 planned (this batch / next)
- 💡 backlog (do when we get to it)

---

## Batch 1 — Stabilize & secure  ✅ *(done — commit on `stabilize-and-fixes`)*
| Item | Status | File |
| --- | --- | --- |
| Upgrade `next` 15.1.4 → **15.5.18** (clears flight-protocol RCE, request smuggling, DoS, transitive postcss XSS) → `npm audit` = 0 vulns | ✅ | `web/package.json` |
| Fix `docker-compose.yml` `env_file` → `web/.env.local` (otherwise container has **no creds**) | ✅ | `docker-compose.yml` |
| Fix stale README claim that the web app doesn't read `KSFIT_EMAIL`/`KSFIT_PASSWORD` (it now does, via auto-login) | ✅ | `README.md` |
| Add committed ESLint config (`eslint-config-next`) + network-free CI (typecheck + lint + test) | ✅ | `web/eslint.config.mjs`, `.github/workflows/ci.yml` |

## Batch 2 — Correctness + test safety net  *(mostly done)*
| Item | Status | File |
| --- | --- | --- |
| Add Vitest + unit tests for `data.ts` (normalizeSession, parsePointList, dayKey/groupByDay, currentStreak) — **20 tests** | ✅ | `web/src/lib/__tests__/data.test.ts` |
| Reconcile `consume` kcal scale — code `/1000` is **verified correct**; fixed stale `×10` comments and added `CONSUME_SCALE` constant | ✅ | `data.ts`, `ksfit.ts`, `client.py` |
| Unify UTC-vs-local timestamp rendering behind `fmtDate`/`fmtTime`/`fmtDateTime` | ✅ | `data.ts`, page components |
| Persist token rotation on all fetch paths via shared `ensureRotationPersist` (`fetchSessions` previously lacked it) | ✅ | `session.ts`, `fetchers.ts` |
| Add `/api/health` route + compose healthcheck (no KS Fit traffic) | ✅ | `web/src/app/api/health/route.ts`, `docker-compose.yml` |

---

## Batch 3 — Home-network + DNS deployment (host-side, no app code)

**Model:** keep the container on `127.0.0.1:3005`, front it with Caddy terminating local HTTPS for `treadmill.home`, resolve via UniFi local DNS, never expose to WAN.

### Runbook
1. **Static DHCP lease** for the Docker host (UniFi → Client Devices → host → Fixed IP, e.g. `192.168.1.10`, outside the DHCP pool).
2. **UniFi local DNS record:** Settings → Routing & Security (or Networks) → Local DNS Records → A record `treadmill.home` → host IP. Verify: `nslookup treadmill.home`.
3. **Keep app loopback-only:** leave `127.0.0.1:3005:3000`. Verify `ss -ltnp | grep 3005` shows `127.0.0.1`, not `0.0.0.0`.
4. **Install Caddy** on the host (only thing listening on the LAN at 80/443).
5. **Caddyfile:**
   ```caddyfile
   treadmill.home {
       tls internal
       encode zstd gzip
       reverse_proxy 127.0.0.1:3005
   }
   ```
   Caddy auto-redirects 80→443 and forwards `X-Forwarded-*`, so Next sees `https` — no code change needed.
6. **Trust the local CA** on each device (one-time, removes cert warnings): trust Caddy's root CA, or use `mkcert -install && mkcert treadmill.home` and point the Caddyfile `tls` at the generated cert/key. iOS/Android need the root installed *and* enabled for SSL.
7. **Lock the perimeter:** no WAN port-forward for 80/443/3005; disable UPnP; no public DNS. For remote access later, use a VPN (UniFi Teleport/WireGuard), never a port-forward — this app auto-logs-in, so anything reachable = full data access.
8. **Host firewall:** allow only 80/443; do not open 3005 (loopback-only).

### Optional: Caddy as a sibling container
Add a `caddy:2-alpine` service, drop the app's `ports:` block, set `reverse_proxy ksfit:3000`, persist `caddy_data` volume for the CA root. (Full snippet in the audit output.)

---

## Batch 4 — Quick-win features (high value, low/med effort)

| Feature | Why | Effort |
| --- | --- | --- |
| **CSV export** (sessions / weight / per-session points) + buttons | **The project's founding motivation** — currently absent | M |
| **Render bound devices** on Settings (model, name, bind date) | Already fetched in `fetchAll`, just not shown (or drop the fetch) | S |
| **Body-composition card** on Weight page (fat%, water, BMR, visceral, muscle) | Smart-scale data already uploaded; `normalizeWeights` drops most of it | M |
| **Heart-rate UI** (avg/peak per session, HR line on chart, HR-zone bar via `220−age`) | `heartAvg` normalized + `HeartPulse` icon imported but **never rendered** — biggest unrealized value | M |
| **Per-scheme PWA theme-color** | `manifest.ts` is hardcoded dark; clashes in light mode | S |

---

## Batch 5 — High-value UI (sequential)

| Feature | Notes | Effort |
| --- | --- | --- |
| `loading.tsx` / `error.tsx` boundaries | Every page is `force-dynamic` and blocks on serialized fetches; a `KSFitError` (rate-limit/expiry) hits Next's default overlay. Make them rate-limit-aware; redirect auth errors to `/login` | M |
| Richer per-second telemetry | pace-over-distance, cadence distribution, fastest-km, moving-vs-paused split, per-split cadence/HR | M |
| "This week" + personal-bests card | week-over-week deltas; longest session/best day/week/streak; weekly distance/active-day goal (Settings registry makes adding goals cheap) | M |
| Extend `parsePointList` for HR/slope columns | verify indices against **one** dumped session, not a loop | M |

---

## Batch 6 — Stretch / optional
- **Courses view** — group sessions by `courseName`; lazily-fetched Plans page (`schedule.listMy`) on its own route (not `fetchAll`, to respect rate limits).
- **Family view** — `share.getgrouplist` + `record.getShareRecord` (read-only).
- **Notices/inbox** — header badge via `notice.hint`, drawer via `notice.getParentList/getChildList` (cache heavily).
- **Leaderboard** — `ranking.getType` + `ranking.get`, paginated, on demand.
- **Accessibility pass** — heatmap `role=grid` + aria-live; Recharts `role=img` + summary + visually-hidden table fallback.
- **Sessions filtering/pagination** — quick-filter chips (Apple Watch / has-course / by device), numeric filters, windowed rendering for multi-year histories.
- **Cache hardening** — in-flight promise dedupe (stampede guard), jittered backoff on `KSFitError` code 141 (rate-limit), document single-process/single-worker requirement.
- **Client reconciliation** — TS handles `ret=402` token rotation; Python re-logs-in on 401/403. Only one matches reality; document the answer in both, consider a shared envelope/codes spec.
- **PWA install affordance** — capture `beforeinstallprompt`; let cached session-detail render offline.

---

## API surface — untapped data (already-available, mostly zero extra calls)

The Python client wraps **~40** read-only services; the dashboard renders only **5**.

| Endpoint(s) | Status | Enables |
| --- | --- | --- |
| `record.heart` / `heart_list` | fetched/parsed, never rendered | Avg/peak HR, HR-over-time, HR zones (**highest unrealized value**) |
| `WeightEntry.waterRate/bmr/visceralFat/muscleVolume` | fetched, dropped in normalize | Full body-composition trends |
| `box.deviceList` | fetched into `DashboardData.devices`, never shown | "Your devices" card |
| `record.getRecordPoint` slope/heart columns | partially parsed | HR + incline traces on session detail |
| `SportRecord.slope_max/power/resistance/floors/oar_frequency/iw_*/target_*` | ignored | Incline/power/resistance, rower cadence, Apple-Watch oxygen/pace, per-session goal |
| `schedule.listMy` + `listFitnessGoalByDateRange` | TS wrapper exists, **dead** | Plan page; server goal-vs-actual overlay on calendar |
| `lesson.personal` + `collectlist`/`getDetail`/`search`/`rankinglist` | wrapper exists, **dead** | Courses view (favorites, history, deep-link via `course_id`) |
| `share.getgrouplist` + `record.getShareRecord` | unexposed | Family view |
| `notice.hint` + `getParentList`/`getChildList` | unexposed | Inbox + unread badge |
| `ranking.get` / `ranking.getType` | unexposed | Leaderboard |
| `tag.*`, `target.getList`, `user.userbind`, `user.getUserInfo`, `product.*` | unexposed | Human-readable labels, linked accounts, resolve names, enrich devices |

### ⚠️ Safe API-probing rule
Do **NOT** run `examples/explore_services.py` — it fans out 12 workers over thousands of candidates and **will trip the account lockout**. To probe an undocumented endpoint later: issue **1–2 single** `c.call(svc, **params)` reads, spaced minutes apart, **read-shaped verbs only** (`getList`/`getDetail`/`getCurrent`), never `add/upload/edit/delete/disable` (some probe names like `user.disablefacebook` are misleading). Mirror the sequential `inspect_key_services.py` pattern.

---

## Security notes (post-verification)

- **Only must-do:** upgrade `next` → `15.5.18` (Batch 1). The headline "middleware auth-bypass" was **refuted** — authz is enforced in the data layer (`requireSession`), and in auto-login mode middleware is a deliberate no-op.
- **Acceptable as configured** (single-user, gitignored creds, loopback bind): 90-day JWT cookie lifetime, `secure` gated on `NODE_ENV`, `KSFIT_BASE_URL` egress. Optional hardening only.
- **Docker is well-hardened** already (non-root, `no-new-privileges`, loopback bind, resource limits). Optional: `read_only: true` + tmpfs, `cap_drop: [ALL]`.
- **Fail-closed idea:** require an explicit opt-in env before auto-login activates, so an accidental public bind doesn't silently expose data.
