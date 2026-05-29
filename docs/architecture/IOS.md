# Phase 5 — iOS native app readiness

**Status:** Documentation + readiness checklist. The Xcode app itself is **not**
built in this repo yet (deferred). Everything the backend needs to serve a
native client is in place; this doc is the handoff for when iOS work starts.

> Why this is "ready, not built": the whole point of the backend/frontend split
> (Phases 1–4) was that iOS is *just another client* of the same HTTP API the
> web app uses. There is **zero new backend contract work** for iOS — it reuses
> the exact `/v1/*` endpoints, the opaque-session auth, and the Zod-defined
> response shapes in `packages/shared-types`.

---

## 1. What the iOS app consumes

The same backend, unchanged:

- **Base URL:** `https://treadmill.home/api` on the home LAN (or the user's
  chosen host). All endpoints under `/api/v1/*`.
- **Endpoints** (already implemented, see `docs/architecture/02-API-CONTRACT.md`):
  - `POST /v1/auth/login`, `POST /v1/auth/logout`
  - `GET /v1/metrics/{recovery,strain,sleep,stress,fitness-age,hrv,daily-activity}`
  - `GET /v1/exercises`, `GET /v1/exercises/:id`
  - `GET /v1/profile`
  - `POST /v1/coach/chat` (streamed)
  - `GET /v1/fitbit/connect|callback`, `POST /v1/fitbit/disconnect|log`
  - `GET /v1/export/{sessions.csv,weight.csv,points/:runId}`
- **Response shapes:** defined as Zod schemas in `packages/shared-types/src/schemas/`.
  These are the contract — the Swift models below must mirror them.

---

## 2. Auth model (web cookie ↔ iOS Bearer — one validation path)

The backend validates the **same opaque 256-bit session token** regardless of
transport (see `02-API-CONTRACT.md §0` and the Phase 2 `app_sessions` table):

- **Web:** the token rides in an `httpOnly` `stride_session` cookie.
- **iOS:** the token is stored in the **Keychain** and sent as
  `Authorization: Bearer <token>`.

The iOS login flow:
1. `POST /v1/auth/login` with the KS Fit email/password (or, once Phase 2 lands,
   a device-pairing handshake). Response returns the session token in the body
   for native clients (web gets it as a `Set-Cookie`).
2. Store the token in the iOS Keychain (`kSecClassGenericPassword`,
   `kSecAttrAccessibleAfterFirstUnlock`).
3. Attach `Authorization: Bearer <token>` to every subsequent request.
4. On `401 unauthenticated`, clear the Keychain entry and re-run login.

> The backend's session validation middleware (Phase 2) already accepts either
> the cookie **or** the Bearer header — no iOS-specific server code.

---

## 3. Generating the Swift client

The contract is Zod-first. To get a typed Swift client:

1. **Emit the OpenAPI spec** from the Zod schemas (the remaining Phase 1b task —
   `GET /openapi.json` on the backend, built with `zod-to-openapi`). Until that
   endpoint ships, the `packages/shared-types/src/schemas/*.ts` files are the
   authoritative shapes to transcribe.
2. **Generate Swift** from the spec with Apple's official generator:
   [`swift-openapi-generator`](https://github.com/apple/swift-openapi-generator)
   (a SwiftPM plugin). Add it to the iOS target's `Package.swift`; it produces
   `Client` + `Types` from `openapi.json` at build time.
3. Pair it with `swift-openapi-urlsession` for the transport, and an auth
   middleware that injects the Keychain Bearer token.

```swift
// Sketch — the generated Client + an auth middleware.
let client = Client(
    serverURL: URL(string: "https://treadmill.home/api")!,
    transport: URLSessionTransport(),
    middlewares: [BearerAuthMiddleware(tokenProvider: Keychain.sessionToken)]
)
let recovery = try await client.getRecovery(.init(query: .init(date: today)))
```

---

## 4. Push notifications (APNs)

The weekly weight reminder + readiness briefings reuse the **one**
`push_subscriptions` table (Phase 2 schema), which already has a `kind` column
(`web` | `apns`):

- Web uses **Web Push (VAPID)**.
- iOS registers an **APNs** device token via `POST /v1/push/*` with `kind:"apns"`.
- The reminder cron fans out to both kinds from the same table — no separate
  iOS notification backend.

---

## 5. Build steps (when iOS work starts)

1. `apps/ios/` — a new SwiftUI app target (Xcode project or SwiftPM).
2. Add `swift-openapi-generator` + `swift-openapi-urlsession` dependencies.
3. Drop the backend's `openapi.json` into the target; the plugin generates the
   client on build.
4. Implement: Keychain session store, `BearerAuthMiddleware`, a thin
   view-model layer over the generated client, and SwiftUI screens mirroring the
   web dashboards (Recovery / Strain / Sleep / HRV / Stress / Fitness Age /
   Exercises / Coach chat). The coach screen consumes the `POST /v1/coach/chat`
   SSE stream.
5. APNs entitlement + device-token registration to `/v1/push`.

**Prerequisite from this repo:** ship the `GET /openapi.json` endpoint (the last
Phase 1b item) so step 3 is a generator run rather than hand-transcription.

---

## 6. What's NOT done here (explicit)

- No Xcode project, no Swift code, no simulator build — deferred by request
  (no Xcode/simulator tooling in the current environment).
- The OpenAPI emission endpoint (`/openapi.json`) is pending as part of finishing
  Phase 1b; the Zod schemas are ready to drive it.
