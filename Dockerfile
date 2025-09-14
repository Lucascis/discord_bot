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

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files maintaining directory structure
COPY packages/ ./packages/
COPY gateway/package.json ./gateway/package.json
COPY audio/package.json ./audio/package.json
COPY api/package.json ./api/package.json
COPY worker/package.json ./worker/package.json

# Install dependencies (use --frozen-lockfile for production builds)
RUN pnpm install --no-frozen-lockfile

# Builder stage - compile TypeScript to JavaScript
FROM base AS builder

# Copy source code
COPY . .

# Generate Prisma client first
RUN pnpm --filter @discord-bot/database prisma:generate

# Build all packages and services
RUN pnpm -r build

# Keep Prisma client for production
# Skip removing dev dependencies since Prisma client is needed

# Production stage - final optimized image
FROM node:22-alpine AS production

# Create non-root user for security (Alpine)
RUN addgroup -g 1001 nodejs \
  && adduser -D -u 1001 -G nodejs nextjs

# Enable corepack for pnpm and install runtime dependencies
RUN corepack enable pnpm \
  && apk add --no-cache openssl ca-certificates wget

# Set working directory
WORKDIR /app

# Copy built application from builder stage with all dependencies
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/gateway ./gateway
COPY --from=builder --chown=nextjs:nodejs /app/audio ./audio
COPY --from=builder --chown=nextjs:nodejs /app/api ./api
COPY --from=builder --chown=nextjs:nodejs /app/worker ./worker
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./

# Switch to non-root user
USER nextjs

# Health check endpoint - more secure implementation
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/health || exit 1

# Default command (overridden by docker-compose)
CMD ["node", "-e", "console.log('Set service command in docker-compose.yml. Available services: gateway, audio, api, worker')"]
