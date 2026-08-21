# ---- build web (Vite SPA) ----
FROM node:24-slim AS web
WORKDIR /app/web
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

# ---- build server (TS → dist) + prod deps (native better-sqlite3) ----
FROM node:24-slim AS server
WORKDIR /app/server
COPY apps/server/package.json apps/server/package-lock.json* ./
RUN npm ci
COPY apps/server/ ./
RUN npm run build && npm prune --omit=dev

# ---- runtime: one Node process serves API + mock + Scalar + the SPA ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    APIONE_DATA_DIR=/data \
    APIONE_WEB_DIST=/app/web \
    HOST=0.0.0.0 \
    PORT=4100

# oasdiff (breaking-change engine): pinned binary, matches the build arch (amd64/arm64).
# Its LICENSE is kept beside it — Apache-2.0 requires it to travel with the binary, and the build
# should fail rather than ship without it.
ARG OASDIFF_VERSION=1.21.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && arch="$(dpkg --print-architecture)" \
 && curl -fsSL "https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_linux_${arch}.tar.gz" -o /tmp/oasdiff.tar.gz \
 && mkdir -p /tmp/oasdiff /usr/local/share/oasdiff \
 && tar -xzf /tmp/oasdiff.tar.gz -C /tmp/oasdiff \
 && mv /tmp/oasdiff/oasdiff /usr/local/bin/oasdiff \
 && cp /tmp/oasdiff/LICENSE /usr/local/share/oasdiff/LICENSE \
 && rm -rf /tmp/oasdiff /tmp/oasdiff.tar.gz \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/package.json ./package.json
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/drizzle ./drizzle
COPY --from=web /app/web/dist ./web
# The image redistributes OFL-licensed fonts and Scalar's bundle, whose licenses must travel with
# them.
COPY THIRD-PARTY-NOTICES.md ./
COPY licenses ./licenses
VOLUME /data
EXPOSE 4100
CMD ["node", "dist/index.js"]
