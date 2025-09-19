# 🚀 Production Deployment Guide - Discord Music Bot

## 🎯 **Deployment Status**

| Implementation | Status | Readiness | Recommendation |
|---------------|--------|-----------|----------------|
| **Legacy** (`src-legacy/`) | ✅ Production Ready | 100% | 🚀 **Deploy Now** |
| **MVC** (`src-mvc/`) | 🆕 Recently Implemented | 95% | 🧪 Test First |
| **Clean Architecture** (`src/`) | ⚠️ In Development | 80% | 🚧 Development Only |

## 🚀 **Quick Production Deploy (Legacy)**

### Prerequisites
- **Docker & Docker Compose** installed
- **Discord bot token** and application ID
- **4GB+ RAM** recommended (2GB minimum)
- **Port access**: 3000-3003, 2333, 5432, 6379, 9090, 3300
- **Storage**: 10GB+ available

### 1. Quick Production Setup
```bash
# Clone repository
git clone <repository-url>
cd discord_bot

# Configure environment
cp .env.example .env.docker

# Edit with your credentials
DISCORD_TOKEN=your-bot-token-here
DISCORD_APPLICATION_ID=your-application-id-here
LAVALINK_PASSWORD=youshallnotpass
```

### 2. Deploy Production Stack
```bash
# Option A: Use deployment script (recommended)
./scripts/start.sh

# Option B: Direct Docker Compose
docker-compose -f docker-compose.production.yml up -d

# Option C: Legacy implementation only
cd gateway && node src-legacy/index.js
```

### 4. Verify Deployment
- Bot online in Discord ✓
- Health checks: http://localhost:3000/health
- Grafana dashboard: http://localhost:3300 (admin/admin)

---

## 📋 Service Architecture

### Core Services
- **Gateway** (Port 3001) - Discord.js interface, slash commands
- **Audio** (Port 3002) - Lavalink integration, music playback
- **API** (Port 3000) - REST endpoints, health checks
- **Worker** (Port 3003) - Background task processing

### Infrastructure
- **PostgreSQL** (Port 5432) - Persistent data storage
- **Redis** (Port 6379) - Cache and pub/sub messaging
- **Lavalink** (Port 2333) - Audio streaming server

### Monitoring
- **Prometheus** (Port 9090) - Metrics collection
- **Grafana** (Port 3300) - Dashboards and visualization

---

## 🐳 Docker Configuration

### Production Stack
```bash
# Start all services
docker-compose -f docker-compose.production.yml up -d

# View logs
docker-compose -f docker-compose.production.yml logs -f [service]

# Stop all services
docker-compose -f docker-compose.production.yml down
```

### Service Dependencies
```
PostgreSQL → Migrations → Gateway/Audio/API/Worker
Redis → Gateway/Audio
Lavalink → Audio
```

---

## 🔧 Configuration Guide

### Discord Setup
1. Create application at https://discord.com/developers/applications
2. Create bot user and copy token
3. Enable required intents:
   - Guilds
   - Guild Messages
   - Guild Voice States
4. Generate invite URL with permissions:
   - Connect
   - Speak
   - Use Slash Commands

### Music Sources (Optional)
```bash
# Spotify API
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret

# YouTube Enhanced (Advanced)
YOUTUBE_REFRESH_TOKEN=your-refresh-token
YOUTUBE_PO_TOKEN=your-po-token
```

---

## 📊 Monitoring & Health Checks

### Health Endpoints
- Gateway: http://localhost:3001/health
- Audio: http://localhost:3002/health
- API: http://localhost:3000/health
- Worker: http://localhost:3003/health
- Lavalink: http://localhost:2333/version

### Grafana Dashboards
Access: http://localhost:3300 (admin/admin)

**Available Dashboards:**
- Discord Bot Overview
- Audio Service Metrics
- Database Performance
- System Resources

### Prometheus Metrics
Access: http://localhost:9090

**Key Metrics:**
- `discord_commands_total` - Command usage
- `audio_tracks_played_total` - Music statistics
- `database_connections_active` - DB health
- `lavalink_players_total` - Active players

---

## 🛠 Maintenance

### Database Operations
```bash
# Run migrations
docker-compose -f docker-compose.production.yml run --rm migrate

# Backup database
docker exec discord-bot-postgres pg_dump -U postgres discord_bot > backup.sql

# Restore database
cat backup.sql | docker exec -i discord-bot-postgres psql -U postgres discord_bot
```

### Log Management
```bash
# View live logs
docker-compose logs -f gateway

# Export logs
docker-compose logs --since="1h" > logs.txt
```

### Updates
```bash
# Update images and restart
git pull
docker-compose -f docker-compose.production.yml pull
docker-compose -f docker-compose.production.yml up -d --force-recreate
```

---

## 🔍 Troubleshooting

### Common Issues

**Bot offline after deployment:**
1. Check Discord token validity
2. Verify network connectivity: `docker-compose logs gateway`
3. Ensure bot has proper permissions in Discord server

**No audio playback:**
1. Check Lavalink health: http://localhost:2333
2. Verify YouTube plugin loaded: `docker-compose logs lavalink`
3. Test audio service: http://localhost:3002/health

**Database connection errors:**
1. Wait for PostgreSQL startup (can take 30s)
2. Check logs: `docker-compose logs postgres`
3. Verify DATABASE_URL in .env.docker

**High memory usage:**
1. Check active music sessions: Grafana dashboard
2. Adjust Lavalink memory: Edit `_JAVA_OPTIONS: "-Xmx2G"`
3. Monitor with: `docker stats`

### Debug Mode
```bash
# Enable debug logging
echo "LOG_LEVEL=debug" >> .env.docker
docker-compose -f docker-compose.production.yml restart
```

---

## 🔒 Security Considerations

### Production Checklist
- [ ] Change default passwords (Grafana, PostgreSQL)
- [ ] Use strong Discord bot token
- [ ] Limit port exposure (use reverse proxy)
- [ ] Enable Docker secrets for sensitive data
- [ ] Regular security updates
- [ ] Monitor logs for suspicious activity

### Network Security
```bash
# Restrict external access (production)
# Only expose necessary ports via reverse proxy
# Use firewall rules to limit access
```

---

## 📈 Scaling

### Horizontal Scaling
- Deploy multiple Audio service instances
- Use Redis cluster for high availability
- Load balance Gateway instances
- Separate database server

### Performance Optimization
- Increase Lavalink memory allocation
- Tune PostgreSQL configuration
- Use SSD storage for database
- Monitor and optimize slow queries

### Resource Requirements

**Minimum (Single Server):**
- 2 CPU cores
- 2GB RAM
- 10GB storage

**Recommended (Production):**
- 4 CPU cores
- 4GB RAM
- 50GB SSD storage
- Load balancer
- Backup strategy