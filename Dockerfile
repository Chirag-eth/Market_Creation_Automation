FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY styles.css ./
COPY src ./src
COPY Info-source ./Info-source
COPY .env.example ./

ENV NODE_ENV=production
EXPOSE 2020

CMD ["node", "server.js"]
