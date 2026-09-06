FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production && \
    npm cache clean --force

COPY server.js expense-entry.js gallery-entry.js space-entry.js ./
COPY fonts ./fonts

EXPOSE 3000

CMD ["node", "server.js"]
