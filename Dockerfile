# syntax=docker/dockerfile:1.7

# Stage 1: build the Vite frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend ./frontend
# Vite reads frontend/index.html as the template (see frontend/vite.config.js)
# and writes its own public/index.html — no need to seed one here.
RUN npm run build:frontend

# Stage 2: production server (no devDeps, pre-built assets)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts
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
