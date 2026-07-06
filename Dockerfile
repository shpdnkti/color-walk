FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY server.js ./server.js
COPY index.html ./index.html
COPY src/ ./src/

EXPOSE 8080
CMD ["npm", "start"]
