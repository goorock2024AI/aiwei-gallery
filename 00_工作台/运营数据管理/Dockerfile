FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production && \
    npm cache clean --force

COPY server.js expense-entry.js gallery-entry.js space-entry.js governance-batches.js trial-observability.js VERSION ./
COPY sql/m6-forward-manifest.json ./sql/m6-forward-manifest.json
COPY fonts ./fonts

EXPOSE 3000

CMD ["node", "server.js"]
