FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY index.html ./index.html
COPY src/ ./src/
COPY server/ ./server/
COPY server.js ./server.js

EXPOSE 3000
CMD ["node", "server.js"]
