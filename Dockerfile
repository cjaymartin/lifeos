# ── build stage (only used by --target runtime) ──────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── pinned production stage (opt-in: docker build --target runtime) ──────────
FROM node:22-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

WORKDIR /app

# Only the compiled output + its own package manifest are needed at runtime
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
# Content is volume-mounted at runtime; copy here as a baseline fallback
COPY --from=builder /app/src/content ./src/content
# Project skills (populate-daily, populate-deliveries) — required by the
# headless `claude -p /<skill>` spawns from the refresh endpoints.
COPY --from=builder /app/.claude ./.claude

# @astrojs/node standalone build embeds its own dependencies inside dist/
# but the top-level package.json engine guard still wants node ≥22
RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]

# ── watch stage (default) ─────────────────────────────────────────────────────
# Self-rebuilding container: the repo is bind-mounted read-only at /app and
# nodemon watches structural code (src minus src/content, public, configs).
# On change it re-runs npm ci only if package-lock.json changed, rebuilds the
# Astro output into the dist/ named volume, and restarts the server — so code
# changes on the host go live without ever rebuilding this image.
FROM node:22-slim AS watch

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# procps gives nodemon `ps` for reliable child-process-tree kills on restart
RUN apt-get update && apt-get install -y --no-install-recommends procps \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app
USER node

# Pre-seed node_modules (copied into the named volume on first use) so the
# first boot doesn't wait on npm ci; the stamp lets build-and-serve.sh skip
# reinstalling until package-lock.json actually changes.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev \
  && md5sum package-lock.json | cut -d' ' -f1 > node_modules/.lock-hash \
  # dist/ and .astro/ become named volumes — pre-create them owned by node so
  # the volume mountpoints aren't root-owned (EACCES on first build otherwise)
  && mkdir -p dist .astro

EXPOSE 4321

CMD ["npx", "nodemon"]
