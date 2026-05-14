# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Stage 1 — install deps (cached separately from source)
# Next.js app lives in web/ subdirectory; build context is the project root.
# Native toolchain installed as a virtual package so it can be dropped after
# `npm ci` (no native deps today, but keeps the stage robust to future adds).
# -----------------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund \
 && apk del .build-deps

# -----------------------------------------------------------------------------
# Stage 2 — build (runs `next build` inside the container)
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY web/ .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3 — runtime (only the standalone output + static + public)
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache tini
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Standalone Next output: contains server.js + traced node_modules.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Non-root by default (Next standalone is happy as a non-root user).
RUN addgroup -g 1001 nodejs && adduser -S nextjs -u 1001 -G nodejs \
 && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

ENTRYPOINT ["/sbin/tini","--"]
CMD ["node","server.js"]
