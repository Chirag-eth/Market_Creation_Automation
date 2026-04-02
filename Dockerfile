FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY src ./src
COPY catalog ./catalog
COPY .env.example ./

ENV NODE_ENV=production
EXPOSE 2020

CMD ["node", "server.js"]
