# Multi-stage build for the Next.js app (standalone output). Produces a small
# runtime image suitable for Cloud Run, Fly, Render, or plain Docker.
#
# Build:  docker build -t local-initiative .
# Run:    docker run -p 3000:3000 --env-file .env.local local-initiative
# Note:   run `prisma migrate deploy` (and db:grant) against your database
#         separately before/at deploy — the container does not migrate on boot.

# ── deps: install with a warm cache ──────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# sharp needs the standard build toolchain only if a prebuilt binary is missing;
# node:bookworm has glibc so the prebuilt sharp binary is used.
COPY package.json package-lock.json ./
RUN npm ci

# ── build: generate Prisma client + compile Next ─────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# DATABASE_URL isn't needed to build; a dummy keeps Prisma's client generation happy.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── runtime: minimal standalone server ───────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Standalone server + static assets + public dir.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
# Prisma engine + schema for runtime queries.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma

# Uploaded media (LocalDiskStore) — mount a volume here in production, or use a
# cloud MediaStore and this stays empty.
RUN mkdir -p /app/storage/media && chown -R nextjs:nodejs /app/storage
VOLUME /app/storage

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
