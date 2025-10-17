# 🐳 Docker Deployment Guide

This guide explains how to run the Discord Music Bot using Docker on **any platform** (Windows, macOS, Linux).

## 📋 Prerequisites

- **Docker Desktop** (or Docker Engine + Docker Compose on Linux)
  - Windows/Mac: https://www.docker.com/products/docker-desktop/
  - Linux: Install Docker Engine and Docker Compose via package manager
- **Minimum 4GB RAM** (8GB recommended)
- **5GB free disk space**

## 🚀 Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/Lucascis/discord_bot.git
cd discord_bot
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your credentials
```

**Required variables in `.env`:**
```env
# Discord Bot Credentials (from https://discord.com/developers/applications)
DISCORD_TOKEN=your-bot-token-here
DISCORD_APPLICATION_ID=your-application-id-here

# Database connection (leave as-is for Docker)
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord

# Redis connection (leave as-is for Docker)
REDIS_URL=redis://redis:6379

# Lavalink configuration
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass

# Optional: Spotify integration
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
```

### 3. Start All Services

```bash
docker compose up -d
```

This will:
- Download all required Docker images
- Build the bot services
- Start PostgreSQL, Redis, and Lavalink
- Start Gateway, Audio, API, and Worker services

**First run will take 5-10 minutes** to download images and build services.

### 4. Verify Services

```bash
# Check all containers are running
docker compose ps

# View logs
docker compose logs -f
```

All services should show `Up` or `healthy` status.

## 📊 Service Architecture

The bot runs 7 containers:

| Container | Purpose | Port | Health Endpoint |
|-----------|---------|------|----------------|
| `discord-postgres` | PostgreSQL database | 5432 | N/A |
| `discord-redis` | Redis cache/pub-sub | 6379 | N/A |
| `discord-lavalink` | Audio streaming server | 2333 | http://localhost:2333/version |
| `discord-gateway` | Discord bot interface | 3001 | http://localhost:3001/health |
| `discord-audio` | Music playback logic | 3002 | http://localhost:3002/health |
| `discord-api` | REST API | 3000 | http://localhost:3000/health |
| `discord-worker` | Background jobs | 3003 | http://localhost:3003/health |

## 🎮 Common Commands

### Starting/Stopping

```bash
# Start all services
docker compose up -d

# Stop all services (preserves data)
docker compose down

# Stop and remove all data (complete reset)
docker compose down -v
```

### Viewing Logs

```bash
# View all logs
docker compose logs -f

# View logs for specific service
docker compose logs -f gateway
docker compose logs -f audio
docker compose logs -f lavalink

# View last 100 lines
docker compose logs --tail=100 gateway
```

### Restarting Services

```bash
# Restart all services
docker compose restart

# Restart specific service
docker compose restart gateway
docker compose restart audio
```

### Rebuilding After Code Changes

```bash
# Rebuild all services
docker compose up -d --build

# Rebuild specific service
docker compose up -d --build gateway
```

### Updating to Latest Version

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose down
docker compose up -d --build
```

## 🔧 Configuration

### All configuration comes from `.env` file

The `docker-compose.yml` uses `env_file: .env` for all services, ensuring:
- ✅ **Platform independent**: Works on Windows, macOS, Linux
- ✅ **Single source of truth**: All config in one place
- ✅ **Secure**: No hardcoded credentials
- ✅ **Easy to update**: Just edit `.env` and restart

### Customizing Ports

If default ports conflict, edit `.env`:

```env
# Change exposed ports (internal ports remain the same)
# Then update port mappings in docker-compose.yml
```

Or edit `docker-compose.yml` port mappings:

```yaml
ports:
  - "3001:3001"  # Change left side only: "HOST:CONTAINER"
```

### Memory Limits

Adjust resource limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 512M  # Adjust as needed
```

## 📝 Database Operations

### Running Migrations

```bash
# Run migrations
docker compose exec gateway pnpm --filter @discord-bot/database prisma migrate deploy

# Generate Prisma client
docker compose exec gateway pnpm --filter @discord-bot/database prisma generate
```

### Database Backup/Restore

```bash
# Backup database
docker compose exec postgres pg_dump -U postgres discord > backup.sql

# Restore database
docker compose exec -T postgres psql -U postgres discord < backup.sql
```

### Reset Database

```bash
# Complete database reset
docker compose down -v
docker compose up -d postgres
# Wait 30 seconds for postgres initialization
docker compose up -d
```

## 🐛 Troubleshooting

### Services Not Starting

```bash
# Check container status
docker compose ps

# View logs for errors
docker compose logs

# Rebuild from scratch
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

### Port Already in Use

**Error**: `Bind for 0.0.0.0:3000 failed: port is already allocated`

**Solution**:
```bash
# Find process using the port
# Windows PowerShell:
netstat -ano | findstr :3000

# macOS/Linux:
lsof -i :3000

# Kill the process or change port in docker-compose.yml
```

### Out of Disk Space

```bash
# Clean unused Docker resources
docker system prune -a --volumes

# View disk usage
docker system df
```

### Lavalink Won't Start

```bash
# Check logs
docker compose logs lavalink

# Verify application.yml syntax
docker compose exec lavalink cat /opt/Lavalink/application.yml

# Restart Lavalink
docker compose restart lavalink
```

### Discord Bot Not Connecting

1. Verify `DISCORD_TOKEN` in `.env`
2. Check Gateway logs: `docker compose logs gateway`
3. Ensure bot has proper intents in Discord Developer Portal
4. Restart gateway: `docker compose restart gateway`

### Audio Not Playing

1. Check Lavalink is running: `docker compose ps lavalink`
2. Verify password matches: `.env` and `lavalink/application.yml`
3. Check audio logs: `docker compose logs audio`
4. Restart audio service: `docker compose restart audio`

## 🔍 Monitoring

### View Resource Usage

```bash
# Real-time resource stats
docker stats

# Disk usage
docker system df
```

### Access Container Shell

```bash
# Access gateway container
docker compose exec gateway sh

# Access database
docker compose exec postgres psql -U postgres discord
```

### Health Checks

```bash
# Check all health endpoints
curl http://localhost:3000/health  # API
curl http://localhost:3001/health  # Gateway
curl http://localhost:3002/health  # Audio
curl http://localhost:3003/health  # Worker
curl http://localhost:2333/version # Lavalink
```

## 🧹 Maintenance

### Clean Docker Cache

```bash
# Remove unused images
docker image prune -a

# Remove all unused resources (careful!)
docker system prune -a --volumes
```

### Update Base Images

```bash
# Pull latest postgres/redis images
docker compose pull

# Restart with new images
docker compose up -d
```

### Logs Management

Logs are stored in `./logs` directory (mounted volume).

```bash
# View logs size
du -sh logs/

# Clear old logs
rm logs/*.log
```

## 🎓 Advanced Usage

### Development Mode with Docker

Start only infrastructure, run services locally:

```bash
# Start only postgres, redis, lavalink
docker compose up -d postgres redis lavalink

# Install dependencies locally
pnpm install

# Run services with hot reload
pnpm dev:all
```

### Production Deployment

```bash
# Use production script
bash scripts/prod.sh

# Or with make
make prod
```

### Custom Network Configuration

```bash
# View network details
docker network inspect discord_discord-network

# Connect external container to network
docker network connect discord_discord-network my-container
```

## 📚 Additional Resources

- **Docker Compose Docs**: https://docs.docker.com/compose/
- **Lavalink Docs**: https://lavalink.dev/
- **Discord.js Guide**: https://discordjs.guide/
- **Project Architecture**: See `CLAUDE.md`

## 🆘 Getting Help

If you encounter issues:

1. Check logs: `docker compose logs -f`
2. Verify `.env` configuration
3. Review this troubleshooting guide
4. Open an issue on GitHub with logs and error messages

---

**✨ Your Discord Music Bot is now fully containerized and portable!**
