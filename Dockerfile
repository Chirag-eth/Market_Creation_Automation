# syntax=docker/dockerfile:1.7

# Stage 1: install all deps + build the Vite frontend, then prune devDeps.
# This is the only stage that runs `npm ci`. The runtime stage just copies
# the already-pruned node_modules over — saving ~50MB of duplicated download
# IO and one full install pass per build.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend ./frontend
# Vite reads frontend/index.html as the template (see frontend/vite.config.js)
# and writes its own public/index.html — no need to seed one here.
RUN npm run build:frontend
# Strip devDeps in place so the runtime stage can copy a lean tree. We keep
# the cache mount around in case `prune` decides to re-resolve anything.
RUN --mount=type=cache,target=/root/.npm npm prune --omit=dev

# Stage 2: production server. No `npm ci` here — we copy the pruned tree
# from the builder. Layers ordered so source changes don't bust the heavy
# node_modules layer.
FROM node:22-alpine
WORKDIR /app
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --chown=node:node server.js ./
COPY --chown=node:node src ./src
COPY --chown=node:node catalog ./catalog
COPY --from=builder --chown=node:node /app/public ./public
ENV NODE_ENV=production
# Default to 8080 so the runtime listens on the port EXPOSE'd below; fly.toml
# also sets PORT=8080 so the two paths agree. server.js falls back to 2020
# only if PORT is unset, which used to leave a `docker run` listening on the
# wrong port.
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server.js"]
