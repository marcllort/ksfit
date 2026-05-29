# Connecting Fitbit

Stride can pull your **heart rate, sleep, daily activity, and weight** from
Fitbit, and **push your WalkingPad walks** to your Fitbit account. This is a
**read trustworthy HR source** for the per-session charts (the KS Fit `heart`
field is ambiguously scaled, so Fitbit is used instead).

> **Heads-up:** Fitbit's legacy Web API is slated for deprecation in **September
> 2026**, migrating to the Google Health API. The integration is built behind a
> `HealthProvider` interface (`web/src/lib/health/`) so swapping providers later
> is a localized change. See `docs/ROADMAP.md`.

## 1. Register a Fitbit "Personal" app (one-time, ~5 min)

1. Go to **https://dev.fitbit.com/apps/new** (sign in with your Fitbit account).
2. Fill in the form. The values that matter:
   - **OAuth 2.0 Application Type:** **Personal** ← important. Personal apps can
     read your *own* intraday heart rate with no special approval.
   - **Callback URL:** must **exactly** match what the app uses. For local dev:
     `http://localhost:3000/api/fitbit/callback`
     For your deployed host: `https://treadmill.home/api/fitbit/callback`
     (You can register only one; pick the one you'll actually use, or register
     two apps.)
   - **Redirect / default scopes:** not enforced here — the app requests
     `heartrate activity sleep weight profile` at connect time.
3. Agree to the terms and save. You'll get a **OAuth 2.0 Client ID** and a
   **Client Secret**.

## 2. Add the credentials to `web/.env.local`

```bash
FITBIT_CLIENT_ID=23ABCD
# Optional. With a secret the app uses confidential-client auth; without it,
# it still works via PKCE (recommended for a Personal app).
FITBIT_CLIENT_SECRET=your-secret-here
# Must EXACTLY match the Callback URL you registered above.
FITBIT_REDIRECT_URI=http://localhost:3000/api/fitbit/callback
```

Restart the dev server (env is read at startup):

```bash
cd web && npm run dev
```

## 3. Connect

Open **/settings**, find the **Fitbit** card, and click **Connect Fitbit**.
You'll be sent to Fitbit's consent screen; approve, and you'll land back on
Settings with the card showing **Connected**.

That's it — heart rate appears on session-detail pages, and a **Push to Fitbit**
button appears on sessions.

## Notes & gotchas

- **Sync latency:** Fitbit's cloud only has data *after your device syncs*
  (phone app / Wi-Fi). HR you query is as fresh as the last sync — expect
  minutes of lag, not real-time.
- **Rate limit:** 150 requests/hour. The dashboard caches Fitbit responses, so
  normal use stays well under it.
- **Pushing walks:** logged as a Walking activity with distance/duration/
  calories. Fitbit derives steps itself (you can't set them directly). Stride
  remembers which sessions it pushed to avoid duplicates.
- **Disconnect:** the Settings card's Disconnect button forgets the tokens
  locally. To fully revoke, also remove the app at
  https://www.fitbit.com/settings/applications.
- **Token storage:** tokens live in an httpOnly cookie (like the KS Fit
  session). Access tokens last 8h and refresh automatically.
