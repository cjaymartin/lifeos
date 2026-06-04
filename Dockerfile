# ── build stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── production stage ──────────────────────────────────────────────────────────
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

# @astrojs/node standalone build embeds its own dependencies inside dist/
# but the top-level package.json engine guard still wants node ≥22
RUN npm install --omit=dev --ignore-scripts 2>/dev/null || true

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
