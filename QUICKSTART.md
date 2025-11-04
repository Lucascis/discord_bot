# Discord Music Bot - Quick Start Guide

Get the Discord Music Bot running in under 10 minutes.

## 🚀 Prerequisites

- **Node.js** 18+ (v20 recommended)
- **pnpm** 8+
- **Docker** & **Docker Compose** (for local development)
- **PostgreSQL** 15+ (or use Docker)
- **Redis** 7+ (or use Docker)
- **Discord Bot Token** ([Get one here](https://discord.com/developers/applications))

## 📦 Quick Setup (Docker Compose)

### 1. Clone and Install

```bash
# Clone repository
git clone <your-repo-url>
cd discord_bot

# Install dependencies
pnpm install

# Generate Prisma client
pnpm --filter @discord-bot/database prisma:generate
```

### 2. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your credentials
nano .env
```

**Minimum required configuration**:

```env
# Discord Configuration
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here

# Database (Docker default)
DATABASE_URL=postgresql://discord:discord_password@localhost:5432/discord_bot?schema=public

# Redis (Docker default)
REDIS_URL=redis://localhost:6379

# Lavalink (Docker default)
LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass

# Node Environment
NODE_ENV=development
```

### 3. Start Services

```bash
# Start all services with Docker Compose
docker-compose up -d

# Wait for services to be ready (~30 seconds)
docker-compose ps

# Check logs
docker-compose logs -f gateway
```

### 4. Verify Setup

```bash
# Check database connection
pnpm --filter @discord-bot/database prisma:migrate dev

# Check services are running
docker-compose ps

# Expected output:
# NAME                    STATUS
# discord-gateway         Up (healthy)
# discord-audio           Up (healthy)
# discord-api             Up (healthy)
# discord-postgres        Up (healthy)
# discord-redis           Up (healthy)
# discord-lavalink        Up (healthy)
```

### 5. Test the Bot

1. Invite bot to your Discord server using this URL:
   ```
   https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=8&scope=bot%20applications.commands
   ```

2. In Discord, type `/play` to test music playback

3. Try other commands:
   - `/queue` - Show current queue
   - `/skip` - Skip current track
   - `/premium trial` - Start 14-day premium trial

## 🎯 Development Workflow

### Running Individual Services

```bash
# Gateway service only
pnpm --filter gateway dev

# Audio service only
pnpm --filter audio dev

# API service only
pnpm --filter api dev

# All services in parallel
pnpm dev:all
```

### Database Operations

```bash
# Run migrations
pnpm db:migrate

# Seed database with test data
pnpm db:seed

# Open Prisma Studio (database GUI)
pnpm --filter @discord-bot/database prisma:studio

# Reset database (WARNING: deletes all data)
pnpm --filter @discord-bot/database prisma:reset
```

### Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test tests/e2e/music-playback.test.ts

# Run with coverage
pnpm test --coverage

# Watch mode
pnpm test --watch
```

### Code Quality

```bash
# Lint all code
pnpm lint

# Fix linting issues
pnpm lint --fix

# Type check all packages
pnpm typecheck

# Build all services
pnpm build
```

## 🐳 Docker Compose Services

### Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| API | http://localhost:3001 | REST API endpoints |
| API Health | http://localhost:3001/health | Health check |
| Lavalink | http://localhost:2333 | Audio streaming |
| PostgreSQL | localhost:5432 | Database |
| Redis | localhost:6379 | Cache & pub/sub |

### Managing Services

```bash
# View logs
docker-compose logs -f gateway
docker-compose logs -f audio
docker-compose logs -f api

# Restart specific service
docker-compose restart gateway

# Stop all services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v

# Rebuild services after code changes
docker-compose up -d --build
```

## ☸️ Kubernetes Deployment

### Prerequisites

- Kubernetes cluster (minikube, kind, GKE, EKS, AKS)
- kubectl configured
- Helm 3

### Quick Deploy

```bash
# Create namespace
kubectl create namespace discord-bot

# Create secrets
kubectl create secret generic discord-bot-secrets \
  --from-literal=discord-token=YOUR_TOKEN \
  --from-literal=discord-client-id=YOUR_CLIENT_ID \
  --from-literal=database-url=postgresql://... \
  --from-literal=redis-url=redis://... \
  -n discord-bot

# Deploy all resources
kubectl apply -f k8s/

# Wait for pods to be ready
kubectl wait --for=condition=ready pod \
  -l app=discord-bot \
  -n discord-bot \
  --timeout=300s

# Check status
kubectl get pods -n discord-bot
kubectl get svc -n discord-bot
kubectl get hpa -n discord-bot
```

### Verify Deployment

```bash
# Check pod status
kubectl get pods -n discord-bot

# View logs
kubectl logs -f deployment/discord-gateway -n discord-bot

# Check auto-scaling
kubectl get hpa -n discord-bot

# Port-forward API for testing
kubectl port-forward svc/discord-api 3001:3001 -n discord-bot
curl http://localhost:3001/health
```

## 🎵 Using the Bot

### Basic Commands

#### Music Playback

```
/play <query>           - Play a song (search or URL)
/play spotify:<url>     - Play from Spotify
/playnext <query>       - Add to front of queue
/playnow <query>        - Play immediately
/pause                  - Pause playback
/resume                 - Resume playback
/skip                   - Skip current track
/stop                   - Stop and clear queue
```

#### Queue Management

```
/queue                  - Show current queue
/queue clear            - Clear the queue
/queue shuffle          - Shuffle the queue
/loop track             - Loop current track
/loop queue             - Loop entire queue
/loop off               - Disable looping
```

#### Audio Effects

```
/bassboost              - Apply bass boost effect
/nightcore              - Apply nightcore effect
/vaporwave              - Apply vaporwave effect
/8d                     - Apply 8D audio effect
/effects clear          - Remove all effects
```

#### Volume & Controls

```
/volume <0-200>         - Set volume (100 = normal)
/volume +10             - Increase volume by 10%
/volume -10             - Decrease volume by 10%
```

#### Premium Features

```
/premium trial          - Start 14-day free trial
/premium upgrade        - Upgrade to premium
/premium status         - Check subscription status
/premium cancel         - Cancel subscription
```

### Button Controls

The bot displays interactive UI with buttons:

**Row 1**: ⏯️ Play/Pause | ⏪ -10s | ⏩ +10s | ⏭️ Skip
**Row 2**: 🔊 Vol + | 🔉 Vol - | 🔁 Loop | ⏹️ Stop
**Row 3**: 🔀 Shuffle | 🗒️ Queue | 🧹 Clear | ▶️ Autoplay

## 🔧 Configuration

### Environment Variables

#### Required

```env
DISCORD_TOKEN=          # Discord bot token
DISCORD_CLIENT_ID=      # Discord application ID
DATABASE_URL=           # PostgreSQL connection string
REDIS_URL=              # Redis connection string
LAVALINK_HOST=          # Lavalink server host
LAVALINK_PORT=          # Lavalink server port
LAVALINK_PASSWORD=      # Lavalink password
```

#### Optional

```env
# Stripe (for premium subscriptions)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_PREMIUM=

# Monitoring
SENTRY_DSN=            # Error tracking
LOG_LEVEL=info         # debug | info | warn | error

# Performance
REDIS_CLUSTER_NODES=   # For Redis cluster mode
DATABASE_POOL_SIZE=25  # Connection pool size

# Features
ENABLE_AUTOPLAY=true
ENABLE_EFFECTS=true
ENABLE_PREMIUM=true
```

### Lavalink Configuration

Edit `lavalink/application.yml` for audio settings:

```yaml
lavalink:
  server:
    password: "youshallnotpass"
    sources:
      youtube: true
      spotify: true
      soundcloud: true

  # High-quality audio
  server:
    playerUpdateInterval: 5
    youtubePlaylistLoadLimit: 6
    opusEncodingQuality: 10  # Maximum quality
    resamplingQuality: HIGH
```

## 📊 Monitoring

### Local Development

```bash
# View application logs
docker-compose logs -f gateway
docker-compose logs -f audio

# Check health endpoints
curl http://localhost:3001/health
curl http://localhost:3001/health/db

# View metrics (if Prometheus is configured)
curl http://localhost:3001/metrics
```

### Production (Kubernetes)

```bash
# Port-forward Grafana
kubectl port-forward svc/grafana 3000:3000 -n monitoring

# Access dashboards at http://localhost:3000
# Default credentials: admin / prom-operator

# Import dashboards from:
# - monitoring/grafana/dashboards/overview.json
# - monitoring/grafana/dashboards/services.json
# - monitoring/grafana/dashboards/business.json
# - monitoring/grafana/dashboards/performance.json
```

## 🔍 Troubleshooting

### Bot Not Responding

```bash
# Check gateway service logs
docker-compose logs gateway

# Common issues:
# 1. Invalid Discord token
# 2. Bot not invited to server with correct permissions
# 3. Commands not registered (wait 5 minutes or restart)
```

### Music Not Playing

```bash
# Check audio service and Lavalink logs
docker-compose logs audio
docker-compose logs lavalink

# Verify Lavalink is running
docker exec discord-lavalink sh -c "nc -z localhost 2333 && echo OK"

# Common issues:
# 1. Lavalink not connected
# 2. Bot not in voice channel
# 3. YouTube plugin not loaded
```

### Database Connection Errors

```bash
# Check PostgreSQL is running
docker-compose ps postgres

# Test connection
docker exec discord-postgres psql -U discord -d discord_bot -c "SELECT 1"

# Run migrations
pnpm db:migrate

# Common issues:
# 1. Wrong DATABASE_URL
# 2. Migrations not run
# 3. PostgreSQL not started
```

### Redis Connection Errors

```bash
# Check Redis is running
docker-compose ps redis

# Test connection
docker exec discord-redis redis-cli ping

# Common issues:
# 1. Wrong REDIS_URL
# 2. Redis not started
# 3. Network policy blocking access (K8s)
```

## 📚 Next Steps

### Essential Reading

1. **Architecture**: Read [docs/architecture/README.md](docs/architecture/README.md)
2. **API Documentation**: Check [docs/api/openapi.yaml](docs/api/openapi.yaml)
3. **Operations**: Review [docs/operations/runbook.md](docs/operations/runbook.md)
4. **Deployment**: See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

### Development

1. **Add Commands**: Create new commands in `packages/commands/`
2. **Add Tests**: Add tests in `tests/` directory
3. **Monitor Performance**: Set up Grafana dashboards
4. **Configure Premium**: Set up Stripe integration

### Production Deployment

1. **Security**: Review [docs/operations/security.md](docs/operations/security.md)
2. **Scaling**: Configure auto-scaling in `k8s/`
3. **Monitoring**: Set up Prometheus + Grafana
4. **Backups**: Configure database backups
5. **CI/CD**: Set up GitHub Actions workflows

## 🆘 Getting Help

### Documentation

- **Full Documentation**: [docs/README.md](docs/README.md)
- **API Reference**: [docs/api/openapi.yaml](docs/api/openapi.yaml)
- **Architecture Diagrams**: [docs/architecture/diagrams/](docs/architecture/diagrams/)
- **Operations Runbook**: [docs/operations/runbook.md](docs/operations/runbook.md)

### Common Issues

| Issue | Solution |
|-------|----------|
| Bot offline | Check `DISCORD_TOKEN`, restart gateway |
| Commands not working | Wait 5 min for registration, check permissions |
| No audio | Check Lavalink connection, verify voice permissions |
| Database errors | Run migrations: `pnpm db:migrate` |
| High latency | Check Redis connection, review cache settings |

### Performance Optimization

- **Cache Hit Rate**: Aim for 80%+ (check Grafana)
- **Response Time**: Target p95 < 500ms
- **Auto-scaling**: Ensure HPA is configured
- **Database**: Add indexes for slow queries
- **Redis**: Use cluster mode for high traffic

## 🎉 Success!

Your Discord Music Bot should now be running!

### Verify Everything Works

- [ ] Bot shows as online in Discord
- [ ] `/play` command works
- [ ] Music plays in voice channel
- [ ] Queue management works
- [ ] Premium trial can be activated
- [ ] API health endpoint responds
- [ ] Grafana dashboards show data (production)

### Production Checklist

Before going to production, ensure:

- [ ] All environment variables configured
- [ ] Secrets properly managed (Kubernetes Secrets)
- [ ] TLS certificates configured
- [ ] Monitoring alerts set up
- [ ] Backup procedures tested
- [ ] Load testing completed (1000+ guilds)
- [ ] Security audit performed
- [ ] Disaster recovery plan documented

---

**Congratulations!** 🎊 You now have a production-ready Discord Music Bot with enterprise-grade infrastructure!

For detailed information, see the [Production Certification Report](PRODUCTION_CERTIFICATION_REPORT.md).
