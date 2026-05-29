#!/bin/sh
# Launch the Stride backend (Hono via tsx) and the Next.js web server in one
# container. If either process exits, take the whole container down so the
# orchestrator (docker compose restart policy) restarts cleanly.
set -eu

# Backend: run from source via the workspace's tsx (no build step needed).
node --import tsx apps/backend/src/index.ts &
BACKEND_PID=$!

# Web: the Next standalone server (apps/web/server.js relative to /app).
node apps/web/server.js &
WEB_PID=$!

# Wait on either; exit with its status so tini reaps and compose restarts.
wait -n "$BACKEND_PID" "$WEB_PID"
EXIT=$?
kill "$BACKEND_PID" "$WEB_PID" 2>/dev/null || true
exit "$EXIT"
