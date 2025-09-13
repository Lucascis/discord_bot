# Multi-stage Docker build for production optimization
FROM node:22-bookworm-slim AS base

# Enable corepack for pnpm and install OpenSSL for Prisma detection
RUN corepack enable pnpm \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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
RUN pnpm install --frozen-lockfile

# Builder stage - compile TypeScript to JavaScript
FROM base AS builder

# Copy source code
COPY . .

# Generate Prisma client first
RUN pnpm --filter @discord-bot/database prisma:generate

# Build all packages and services
RUN pnpm -r build

# Remove dev dependencies for smaller production image
RUN pnpm install --prod --frozen-lockfile

# Production stage - final optimized image
FROM node:22-bookworm-slim AS production

# Create non-root user for security (Debian)
RUN groupadd -g 1001 nodejs \
  && useradd -m -u 1001 -g nodejs nextjs

# Enable corepack for pnpm and install runtime libssl
RUN corepack enable pnpm \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends libssl3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy built application from builder stage
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

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Default command (overridden by docker-compose)
CMD ["node", "-e", "console.log('Set service command in docker-compose.yml. Available services: gateway, audio, api, worker')"]
