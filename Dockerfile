# ============================================================================
# Lizzart Explorer — Unified All-in-One Image (MariaDB + Bun/SvelteKit App)
# Multi-stage build for small size, security, and crash-safe single-volume data
# ============================================================================

# Stage 1: Build SvelteKit production bundle
FROM oven/bun:1-debian AS builder
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Stage 2: Install lean production dependencies only
FROM oven/bun:1-debian AS prod-deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 3: Unified Runtime (Nginx + MariaDB + Bun + Lizzart Explorer + CLI)
FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=3000 \
    APP_INTERNAL_PORT=3001 \
    BODY_SIZE_LIMIT=Infinity \
    STORAGE_ROOT=/data/storage \
    CONFIG_DIR=/data/config \
    ENV_FILE_PATH=/data/config/.env

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx-light \
    ffmpeg \
    mariadb-server \
    mariadb-client \
    ca-certificates \
    curl \
    gosu \
    tini \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /var/lib/mysql/*

# Copy Bun runtime from builder stage
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun

# Create non-root app user
RUN groupadd --system --gid 1001 lizzart \
    && useradd --system --uid 1001 --gid lizzart --home-dir /app --shell /usr/sbin/nologin lizzart

WORKDIR /app

# Copy production build, CLI & lean dependencies
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/database/schema.sql ./database/schema.sql

# Copy hardened Nginx, MariaDB config & unified process supervisor entrypoint + global `lizzart` CLI
COPY docker/nginx-lizzart.conf /etc/nginx/nginx.conf
COPY docker/mariadb-lizzart.cnf /etc/mysql/mariadb.conf.d/99-lizzart.cnf
COPY docker/entrypoint.sh /usr/local/bin/lizzart-entrypoint.sh
COPY scripts/lizzart /usr/local/bin/lizzart
RUN chmod +x /usr/local/bin/lizzart-entrypoint.sh /usr/local/bin/lizzart \
    && chown -R lizzart:lizzart /app \
    && mkdir -p /data/mariadb /data/storage /data/config /run/mysqld /var/log/nginx /var/lib/nginx \
    && chown -R mysql:mysql /data/mariadb /run/mysqld \
    && chown -R lizzart:lizzart /data/storage /data/config

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/lizzart-entrypoint.sh"]
