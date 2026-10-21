FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production && \
    npm cache clean --force

COPY server.js expense-entry.js expense-pdf-entry.js gallery-entry.js space-entry.js governance-batches.js coffee-inventory.js coffee-forecast.js operations-item-analysis.js operations-reports.js operations-report-metrics.js operations-report-html.js trial-observability.js VERSION ./
COPY report-archive.js operations-report-packet.js ./
COPY scripts/archive-weekly-deployment.js ./scripts/archive-weekly-deployment.js
COPY coffee-migrate.js ./coffee-migrate.js
COPY sql/20261021_coffee_inventory.sql ./sql/20261021_coffee_inventory.sql
COPY sql/m6-forward-manifest.json ./sql/m6-forward-manifest.json
COPY app/js/operations-report-layout.js ./app/js/operations-report-layout.js
COPY fonts ./fonts

EXPOSE 3000

CMD ["node", "server.js"]
