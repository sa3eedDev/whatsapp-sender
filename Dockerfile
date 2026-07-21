FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    PORT=80 \
    DATA_ROOT=/data \
    WWEBJS_AUTH_PATH=/data/.wwebjs_auth

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js app.js ./
COPY public ./public
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
    && mkdir -p /data/.wwebjs_auth /data/uploads

EXPOSE 80

VOLUME ["/data"]

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
