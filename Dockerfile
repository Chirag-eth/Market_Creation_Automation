# Stage 1: build the Vite frontend
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY frontend ./frontend
COPY public/index.html ./public/index.html
RUN npm run build:frontend

# Stage 2: production server (no devDeps, pre-built assets)
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY src ./src
COPY catalog ./catalog
COPY --from=builder /app/public ./public
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
