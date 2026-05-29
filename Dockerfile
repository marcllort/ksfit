# syntax=docker/dockerfile:1.7
#
# Stride — one image, two processes (Next.js web + Hono backend) from the pnpm
# monorepo. Caddy fronts it: /api → backend :3001, / → web :3000.
# -----------------------------------------------------------------------------

# Stage 1 — install the full workspace (cached on lockfile).
FROM node:22-alpine AS deps
RUN apk add --no-cache --virtual .build-deps python3 make g++ libc6-compat
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate
WORKDIR /app
# Manifests first for layer caching.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/backend/package.json apps/backend/
COPY packages/ksfit-client/package.json packages/ksfit-client/
COPY packages/health-core/package.json packages/health-core/
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile

# Stage 2 — build the web app (Next standalone). Backend runs from source via
# tsx, so it needs no separate build step.
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# STRIDE_BACKEND_URL is read at runtime, not build; web server components fetch
# the backend on loopback inside the container.
RUN pnpm --filter @stride/web build

# Stage 3 — runtime. Ships the Next standalone server + the backend source +
# the workspace node_modules the backend needs at runtime (tsx, hono, db, etc.).
FROM node:22-alpine AS runner
RUN apk add --no-cache tini libstdc++ libgcc
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Web binds :3000; backend :3001; web reaches backend on loopback.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV BACKEND_PORT=3001
ENV STRIDE_BACKEND_URL=http://127.0.0.1:3001
ENV STRIDE_DB_PATH=/data/stride.db

# Web: Next standalone output (server.js + traced deps + static + public).
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Backend: source + the installed workspace node_modules (run via tsx).
COPY --from=builder /app/apps/backend ./apps/backend
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules

# Persisted SQLite lives on a mounted volume.
RUN mkdir -p /data \
 && addgroup -g 1001 nodejs && adduser -S stride -u 1001 -G nodejs \
 && chown -R stride:nodejs /app /data
USER stride

EXPOSE 3000 3001
VOLUME ["/data"]

# Launch both processes; if either exits, the container exits (compose restarts).
COPY infra/start.sh /start.sh
ENTRYPOINT ["/sbin/tini","--"]
CMD ["/start.sh"]
