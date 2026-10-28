FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && \
    npm cache clean --force

COPY server.js expense-entry.js expense-pdf-entry.js gallery-entry.js space-entry.js governance-batches.js coffee-inventory.js coffee-forecast.js operations-item-analysis.js operations-reports.js operations-report-metrics.js operations-report-html.js trial-observability.js VERSION ./
COPY report-archive.js operations-report-packet.js report-center-api.js ./
COPY space-accounting.js space-booking.js space-payment.js space-quick-rental.js ./
COPY space-contract-profiles.js space-project-workflow.js space-contract-document.js ./
COPY app/js/space-project-schema.js ./app/js/
COPY templates ./templates
COPY scripts/space-project-workflow-migrate.js scripts/space-quick-rental-migrate.js ./scripts/
COPY sql/20261025_space_project_workflow.sql sql/20261028_space_quick_rentals.sql ./sql/
COPY scripts/space-execution-migrate.js ./scripts/
COPY sql/20261024_space_execution.sql ./sql/
COPY weekly-management.js weekly-management-store.js weekly-management-api.js weekly-management-dispatch.js ./
COPY weekly-management-config.js ./
COPY scripts/weekly-management-worker.js scripts/weekly-management-migrate.js ./scripts/
COPY sql/20261022_weekly_management.sql ./sql/
COPY scripts/archive-weekly-deployment.js ./scripts/archive-weekly-deployment.js
COPY daily-brief-policy.js daily-brief-lifecycle.js daily-brief-runner.js daily-brief-template.js daily-brief-core.js daily-brief-render.js daily-brief-connectors.js daily-brief-store.js daily-brief-api.js daily-brief-dispatch.js ./
COPY scripts/align-coffee-closing.js scripts/deploy-report-migrate.js scripts/daily-brief-worker.js scripts/daily-brief-migrate.js ./scripts/
COPY sql/20261021_daily_briefs.sql sql/20261022_daily_delivery_loop.sql ./sql/
COPY coffee-migrate.js ./coffee-migrate.js
COPY sql/20261021_coffee_inventory.sql ./sql/20261021_coffee_inventory.sql
COPY sql/m6-forward-manifest.json ./sql/m6-forward-manifest.json
COPY app/js/operations-report-layout.js ./app/js/operations-report-layout.js
COPY fonts ./fonts

EXPOSE 3000

CMD ["node", "server.js"]
