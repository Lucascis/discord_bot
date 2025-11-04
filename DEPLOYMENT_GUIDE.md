# 🚀 Discord Music Bot - Deployment Guide

**Version**: 1.0.0
**Last Updated**: October 31, 2025
**Status**: Production Ready

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Development)](#quick-start-development)
3. [Production Deployment](#production-deployment)
4. [Docker Deployment](#docker-deployment)
5. [Environment Configuration](#environment-configuration)
6. [Database Setup](#database-setup)
7. [Monitoring & Observability](#monitoring--observability)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | v20+ | Runtime environment |
| **pnpm** | v10+ | Package manager |
| **PostgreSQL** | v15+ | Primary database |
| **Redis** | v7+ | Cache & pub/sub |
| **Docker** | v24+ | Container runtime (optional) |
| **Lavalink** | v4.1.1 | Audio processing server |

### Required Accounts & Keys

- **Discord Bot Token** - From [Discord Developer Portal](https://discord.com/developers/applications)
- **Discord Application ID** - Same portal as above
- **Stripe API Keys** (Optional) - For subscription billing
- **Sentry DSN** (Optional) - For error tracking

---

## Quick Start (Development)

### 1. Clone & Install

```bash
# Clone repository
git clone <repository-url>
cd discord_bot

# Install dependencies
pnpm install
```

### 2. Setup Environment Variables

```bash
# Copy example env file
cp .env.example .env

# Edit .env with your values
nano .env
```

**Minimum Required Variables**:
```env
# Discord
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_APPLICATION_ID=your_application_id_here

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/discord_music_bot

# Redis
REDIS_URL=redis://localhost:6379

# Lavalink
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
```

### 3. Setup Database

```bash
# Run migrations
pnpm db:migrate

# Seed initial data
pnpm db:seed
```

### 4. Start Lavalink

```bash
# Using Docker
docker-compose up -d lavalink

# Verify it's running
curl http://localhost:2333/version
```

### 5. Start Services

```bash
# Development mode (all services)
pnpm dev:all

# Or start individually
pnpm --filter gateway dev
pnpm --filter audio dev
pnpm --filter api dev
pnpm --filter worker dev
```

### 6. Verify Deployment

- Check bot is online in Discord
- Try `/play` command
- Visit `http://localhost:3000/health`

---

## Production Deployment

### 1. Build All Services

```bash
# Build all packages
pnpm build

# Run type checking
pnpm typecheck

# Run tests
pnpm test
```

### 2. Production Environment Setup

Create `.env.production`:

```env
# Node Environment
NODE_ENV=production

# Discord
DISCORD_BOT_TOKEN=<production_bot_token>
DISCORD_APPLICATION_ID=<application_id>
DISCORD_GUILD_ID=<main_guild_id>

# Database (use connection pooling)
DATABASE_URL=postgresql://user:password@db-host:5432/discord_music_bot?connection_limit=20

# Redis (use production instance)
REDIS_URL=redis://:password@redis-host:6379
REDIS_CLUSTER=false

# Lavalink (use dedicated server)
LAVALINK_HOST=lavalink-host
LAVALINK_PORT=2333
LAVALINK_PASSWORD=<secure_password>
LAVALINK_SECURE=false

# API
API_PORT=3000
API_HOST=0.0.0.0

# Stripe (for subscription billing)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC_MONTHLY=price_...
STRIPE_PRICE_BASIC_YEARLY=price_...
STRIPE_PRICE_PREMIUM_MONTHLY=price_...
STRIPE_PRICE_PREMIUM_YEARLY=price_...

# Monitoring
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
ENABLE_METRICS=true

# Logging
LOG_LEVEL=info
```

### 3. Run Production

```bash
# Using PM2 (recommended)
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Or using pnpm
pnpm start
```

### 4. Setup Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## Docker Deployment

### Using Docker Compose

```bash
# Production deployment
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose logs -f gateway audio api

# Scale services
docker-compose up -d --scale gateway=3 --scale audio=2
```

### Build Custom Images

```bash
# Build gateway image
docker build -t discord-bot/gateway:latest -f gateway/Dockerfile .

# Build audio image
docker build -t discord-bot/audio:latest -f audio/Dockerfile .

# Push to registry
docker tag discord-bot/gateway:latest your-registry/discord-bot-gateway:1.0.0
docker push your-registry/discord-bot-gateway:1.0.0
```

---

## Environment Configuration

### Complete Environment Variables Reference

#### Core Configuration

```env
# Environment
NODE_ENV=production                  # development | production | staging

# Discord Configuration
DISCORD_BOT_TOKEN=                   # Required: Bot token
DISCORD_APPLICATION_ID=              # Required: Application ID
DISCORD_GUILD_ID=                    # Optional: Main guild for commands
DEV_GUILD_IDS=                       # Optional: Dev guilds (comma-separated)
```

#### Database Configuration

```env
DATABASE_URL=postgresql://...        # Required: PostgreSQL connection string
DATABASE_POOL_MIN=2                  # Optional: Min pool size (default: 2)
DATABASE_POOL_MAX=10                 # Optional: Max pool size (default: 10)
```

#### Redis Configuration

```env
REDIS_URL=redis://...                # Required: Redis connection string
REDIS_CLUSTER=false                  # Optional: Use cluster mode
REDIS_TLS=false                      # Optional: Enable TLS
```

#### Lavalink Configuration

```env
LAVALINK_HOST=localhost              # Required: Lavalink host
LAVALINK_PORT=2333                   # Required: Lavalink port
LAVALINK_PASSWORD=youshallnotpass    # Required: Lavalink password
LAVALINK_SECURE=false                # Optional: Use WSS
```

#### API Configuration

```env
API_PORT=3000                        # Optional: API port (default: 3000)
API_HOST=0.0.0.0                     # Optional: API host (default: 0.0.0.0)
CORS_ORIGINS=*                       # Optional: CORS origins (comma-separated)
```

#### Stripe Configuration (Optional)

```env
STRIPE_SECRET_KEY=sk_...             # Required for billing
STRIPE_WEBHOOK_SECRET=whsec_...      # Required for webhooks
STRIPE_PRICE_BASIC_MONTHLY=price_... # Product price IDs
STRIPE_PRICE_BASIC_YEARLY=price_...
STRIPE_PRICE_PREMIUM_MONTHLY=price_...
STRIPE_PRICE_PREMIUM_YEARLY=price_...
```

#### Monitoring Configuration (Optional)

```env
SENTRY_DSN=https://...               # Sentry error tracking
SENTRY_ENVIRONMENT=production        # Environment name
SENTRY_TRACES_SAMPLE_RATE=0.1        # Traces sampling (0.0 - 1.0)
ENABLE_METRICS=true                  # Enable Prometheus metrics
```

#### Logging Configuration

```env
LOG_LEVEL=info                       # trace | debug | info | warn | error
LOG_PRETTY=false                     # Pretty print logs (dev only)
```

---

## Database Setup

### 1. Create Database

```sql
CREATE DATABASE discord_music_bot;
CREATE USER discord_bot WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE discord_music_bot TO discord_bot;
```

### 2. Run Migrations

```bash
# Generate Prisma client
pnpm --filter @discord-bot/database prisma:generate

# Run migrations
pnpm db:migrate

# Verify schema
pnpm --filter @discord-bot/database prisma db pull
```

### 3. Seed Initial Data

```bash
# Seed features and development subscriptions
pnpm db:seed
```

### 4. Backup Strategy

```bash
# Daily backup (add to cron)
pg_dump -U discord_bot discord_music_bot > backup_$(date +%Y%m%d).sql

# Restore from backup
psql -U discord_bot discord_music_bot < backup_20251031.sql
```

---

## Monitoring & Observability

### Health Checks

All services expose health check endpoints:

```bash
# Gateway health
curl http://localhost:3000/health

# Audio health
curl http://localhost:3001/health

# API health
curl http://localhost:3000/ready
```

### Metrics (Prometheus)

Metrics are exposed at `/metrics`:

```bash
curl http://localhost:3000/metrics
```

**Key Metrics**:
- `discord_bot_commands_total` - Total commands executed
- `discord_bot_errors_total` - Total errors by type
- `lavalink_players_active` - Active audio players
- `redis_operations_total` - Redis operations
- `http_request_duration_seconds` - API request latency

### Logging

Logs are structured JSON (Pino):

```bash
# View logs in development
pnpm dev:all | pino-pretty

# View logs in production (PM2)
pm2 logs gateway --lines 100
pm2 logs --json | pino-pretty
```

### Error Tracking (Sentry)

Configure Sentry DSN in environment:

```env
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

---

## Troubleshooting

### Bot Not Connecting

**Symptoms**: Bot offline in Discord

**Solutions**:
1. Verify `DISCORD_BOT_TOKEN` is correct
2. Check bot has required intents enabled in Developer Portal
3. Verify network connectivity
4. Check logs: `pm2 logs gateway`

### Voice Connection Fails

**Symptoms**: Bot joins channel but no audio plays

**Solutions**:
1. Verify Lavalink is running: `curl http://localhost:2333/version`
2. Check Lavalink password matches `LAVALINK_PASSWORD`
3. Verify raw voice events are being sent to audio service
4. Check audio service logs for connection errors

### Database Connection Issues

**Symptoms**: Services fail to start with database errors

**Solutions**:
1. Verify PostgreSQL is running
2. Check `DATABASE_URL` connection string
3. Ensure database exists and migrations are run
4. Check connection pool limits

### Redis Connection Issues

**Symptoms**: Commands fail, inter-service communication broken

**Solutions**:
1. Verify Redis is running: `redis-cli ping`
2. Check `REDIS_URL` connection string
3. Verify Redis password if configured
4. Check Redis memory usage

### High Memory Usage

**Symptoms**: Services consuming excessive RAM

**Solutions**:
1. Check for memory leaks in logs
2. Reduce `DATABASE_POOL_MAX`
3. Enable garbage collection monitoring
4. Scale horizontally instead of vertically

### Rate Limiting Issues

**Symptoms**: Discord API 429 errors

**Solutions**:
1. Implement exponential backoff (already implemented)
2. Reduce command frequency
3. Enable request queuing
4. Check for API abuse patterns

---

## Production Checklist

### Pre-Deployment

- [ ] All tests passing (`pnpm test`)
- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] No linting errors (`pnpm lint`)
- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Secrets properly secured (no .env in git)
- [ ] Monitoring configured
- [ ] Backup strategy in place

### Post-Deployment

- [ ] Health checks responding
- [ ] Bot online in Discord
- [ ] Commands working
- [ ] Music playback functional
- [ ] API endpoints accessible
- [ ] Metrics being collected
- [ ] Logs being captured
- [ ] Errors reported to Sentry

### Security Checklist

- [ ] Bot token secured and rotated regularly
- [ ] Database credentials strong
- [ ] Redis password configured
- [ ] Lavalink password strong
- [ ] HTTPS enabled for API
- [ ] Rate limiting configured
- [ ] CORS properly restricted
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention (using Prisma)
- [ ] XSS prevention

---

## Performance Optimization

### Database Optimization

```sql
-- Add indexes for common queries
CREATE INDEX idx_subscriptions_guild_id ON subscriptions(guild_id);
CREATE INDEX idx_queues_guild_id ON queues(guild_id);
CREATE INDEX idx_analytics_created_at ON analytics(created_at);
```

### Redis Optimization

```bash
# Configure maxmemory policy
redis-cli CONFIG SET maxmemory-policy allkeys-lru
redis-cli CONFIG SET maxmemory 2gb
```

### Lavalink Optimization

Edit `lavalink/application.yml`:

```yaml
lavalink:
  server:
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    opusEncodingQuality: 10
    resamplingQuality: HIGH
```

---

## Support & Resources

### Documentation

- [Architecture Overview](./docs/architecture/)
- [API Reference](./docs/reference/)
- [Subscription System](./SUBSCRIPTION_SYSTEM_STATUS.md)
- [Premium Integration](./PREMIUM_INTEGRATION_INSTRUCTIONS.md)

### Getting Help

- **Issues**: [GitHub Issues](https://github.com/your-org/discord-bot/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/discord-bot/discussions)
- **Discord**: Join our support server

---

**Last Updated**: October 31, 2025
**Maintained By**: Development Team
**License**: MIT
