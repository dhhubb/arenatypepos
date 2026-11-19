# ============================================================================
# Afritecx Badboy — production image
# ----------------------------------------------------------------------------
# Build:  docker build -t afritecx-badboy .
# Run:    docker run -d -p 8787:8787 -v afritecx-data:/data \
#           -e SEED_ADMIN_PASSWORD='...' afritecx-badboy
#
# The database lives in the /data volume. Without that mount every restart
# starts from an empty database.
# ============================================================================

# ---- Build stage: compile the single-file frontend ----
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .
# .env.production sets VITE_API_BASE_URL=/api, so the bundle calls the same
# origin that serves it and no CORS configuration is needed.
RUN npm run build

# ---- Runtime stage ----
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    DB_DIR=/data \
    SERVE_STATIC=1

# node:sqlite is built into Node 22.5+, so the server has no runtime
# dependencies to install.
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# Run as the unprivileged user that the official image already provides.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
