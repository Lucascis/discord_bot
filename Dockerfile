# Multi-stage Docker build for production optimization
FROM node:22-alpine AS base

# Security and build metadata
LABEL maintainer="discord-bot-team" \
      org.opencontainers.image.title="Discord Music Bot" \
      org.opencontainers.image.description="Secure Discord music bot with Lavalink" \
      org.opencontainers.image.vendor="Discord Bot Team" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.source="https://github.com/Lucascis/discord_bot" \
      security.scan="trivy" \
      security.base="node:22-alpine"

# Enable corepack for pnpm and install OpenSSL for Prisma detection
RUN corepack enable pnpm \
  && apk add --no-cache openssl ca-certificates

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files (for dependency resolution)
COPY packages/cache/package.json ./packages/cache/package.json
COPY packages/cluster/package.json ./packages/cluster/package.json
COPY packages/commands/package.json ./packages/commands/package.json
COPY packages/config/package.json ./packages/config/package.json
COPY packages/cqrs/package.json ./packages/cqrs/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/event-store/package.json ./packages/event-store/package.json
COPY packages/logger/package.json ./packages/logger/package.json
COPY packages/observability/package.json ./packages/observability/package.json
COPY packages/performance/package.json ./packages/performance/package.json
COPY packages/subscription/package.json ./packages/subscription/package.json

# Copy service package.json files
COPY gateway/package.json ./gateway/package.json
COPY audio/package.json ./audio/package.json
COPY api/package.json ./api/package.json
COPY worker/package.json ./worker/package.json

# Copy Prisma schema BEFORE installation (required for postinstall hook)
COPY packages/database/prisma ./packages/database/prisma

# Install all dependencies (including dev dependencies for build stage)
# Using --no-frozen-lockfile to avoid pnpmfile checksum mismatch in Docker
RUN pnpm install --no-frozen-lockfile

# Builder stage - copy pre-built dist folders and generate Prisma
FROM base AS builder

# Copy all source code including pre-built dist folders
# Note: dist/ folders are commented out in .dockerignore to include them
COPY . .

# Generate Prisma client (required for runtime)
RUN pnpm --filter @discord-bot/database prisma:generate

# Production stage - final optimized image
FROM node:22-alpine AS production

# Create non-root user for security (Alpine)
RUN addgroup -g 1001 nodejs \
  && adduser -D -u 1001 -G nodejs appuser

# Enable corepack for pnpm and install runtime dependencies
RUN corepack enable pnpm \
  && apk add --no-cache openssl ca-certificates wget

# Set working directory
WORKDIR /app

# Copy workspace configuration
COPY --from=builder --chown=appuser:nodejs /app/package.json ./
COPY --from=builder --chown=appuser:nodejs /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=appuser:nodejs /app/pnpm-lock.yaml ./

# Copy all packages with their package.json AND dist folders
# The dist folders must exist for ESM module resolution to work
COPY --from=builder --chown=appuser:nodejs /app/packages ./packages

# Copy services with their dist folders
COPY --from=builder --chown=appuser:nodejs /app/gateway ./gateway
COPY --from=builder --chown=appuser:nodejs /app/audio ./audio
COPY --from=builder --chown=appuser:nodejs /app/api ./api
COPY --from=builder --chown=appuser:nodejs /app/worker ./worker

# Copy pre-installed node_modules from builder layer to avoid reinstalling
COPY --from=builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Optional: Remove devDependencies to reduce image size (uncomment if needed)
# RUN pnpm --filter "!@discord-bot/database" --prod prune

# Switch to non-root user
USER appuser

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1

# Default command (overridden by docker-compose)
CMD ["node", "-e", "console.log('Set service command in docker-compose.yml. Available services: gateway, audio, api, worker')"]

# Gateway Service
FROM production AS gateway
EXPOSE 3001
CMD ["node", "gateway/dist/index.js"]

# Audio Service
FROM production AS audio
EXPOSE 3002
CMD ["node", "audio/dist/index.js"]

# API Service
FROM production AS api
EXPOSE 3000
CMD ["node", "api/dist/index.js"]

# Worker Service
FROM production AS worker
EXPOSE 3003
CMD ["node", "worker/dist/index.js"]
