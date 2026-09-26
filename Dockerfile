# SaiberSecurity production image.
#
# Deliberately a single conventional stage rather than a trimmed standalone build:
# it is larger, but it keeps the Prisma CLI available so the container can apply
# migrations on boot, and it has far fewer ways to break on a first deploy.
FROM node:24-bookworm-slim

# Prisma's query engine needs OpenSSL; curl backs the container healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies first so edits to application code reuse this layer.
# The schema and Prisma config are needed here because postinstall runs `prisma generate`.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --include=dev

COPY . .
RUN npm run build

# SQLite lives on a mounted volume so the database survives redeploys.
RUN mkdir -p /data && chown -R node:node /app /data
VOLUME ["/data"]

COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/login >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
