# 🚀 Quick Start - Docker Production Deployment

**Version**: 1.0.0
**Last Updated**: November 3, 2025
**Estimated Time**: 15-30 minutes

---

## 📋 Prerequisites

### Required Software
- **Docker Desktop** (Windows/Mac) or **Docker Engine** (Linux)
  - Windows: [Download Docker Desktop](https://www.docker.com/products/docker-desktop)
  - Mac: [Download Docker Desktop](https://www.docker.com/products/docker-desktop)
  - Linux: Install via package manager

### Required Information
- Discord Bot Token ([Get one here](https://discord.com/developers/applications))
- Discord Application ID (from same page as bot token)

### System Requirements
- **Minimum**: 4GB RAM, 2 CPU cores, 10GB disk
- **Recommended**: 8GB RAM, 4 CPU cores, 20GB SSD

---

## 🏁 Quick Start (3 Steps)

### Step 1: Clone and Configure

```bash
# Clone repository (use your actual repo URL)
git clone <your-repo-url>
cd discord_bot

# Copy environment template
cp .env.example .env

# Edit .env with your values (use any text editor)
# REQUIRED CHANGES:
#   - DISCORD_TOKEN=<your-bot-token>
#   - DISCORD_APPLICATION_ID=<your-app-id>
```

**Windows PowerShell**:
```powershell
Copy-Item .env.example .env
notepad .env
```

### Step 2: Deploy

**Linux/Mac**:
```bash
chmod +x scripts/deploy-production.sh
./scripts/deploy-production.sh
```

**Windows PowerShell** (Run as Administrator):
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\deploy-production.ps1
```

### Step 3: Verify

1. **Check deployment output** - should say "✅ Deployment completed successfully!"
2. **Check Discord** - bot should appear online
3. **Test command** - Run `/play` in your Discord server
4. **Check health** - Visit [http://localhost:3000/health](http://localhost:3000/health)

---

## ✅ Post-Deployment Verification

### Check All Services Are Running

```bash
docker-compose ps
```

Expected output:
```
NAME                 STATUS              PORTS
discord-gateway      Up (healthy)        0.0.0.0:3001->3001/tcp
discord-audio        Up (healthy)        0.0.0.0:3002->3002/tcp
discord-api          Up (healthy)        0.0.0.0:3000->3000/tcp
discord-worker       Up (healthy)        0.0.0.0:3003->3003/tcp
discord-lavalink     Up (healthy)        0.0.0.0:2333->2333/tcp
discord-postgres     Up (healthy)        0.0.0.0:5432->5432/tcp
discord-redis        Up (healthy)        0.0.0.0:6379->6379/tcp
```

### Test Health Endpoints

```bash
# Gateway
curl http://localhost:3001/health

# Audio
curl http://localhost:3002/health

# API
curl http://localhost:3000/health

# Worker
curl http://localhost:3003/health

# Lavalink
curl http://localhost:2333/version
```

All should return HTTP 200 with healthy status.

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f gateway
docker-compose logs -f audio

# Last 50 lines
docker-compose logs --tail=50 gateway
```

---

## 🎮 Using the Bot

### Available Commands

**Music Playback**:
- `/play <song>` - Play music from YouTube, Spotify, etc.
- `/playnext <song>` - Add to front of queue
- `/playnow <song>` - Play immediately
- `/pause` - Pause playback
- `/resume` - Resume playback
- `/skip` - Skip current track
- `/stop` - Stop and disconnect

**Queue Management**:
- `/queue` - Show current queue
- `/shuffle` - Shuffle queue
- `/clear` - Clear queue
- `/loop <mode>` - Set loop mode (off/track/queue)

**Settings**:
- `/volume <0-100>` - Adjust volume
- `/autoplay <mode>` - Set autoplay mode
- `/settings` - View server settings

**Premium** (if configured):
- `/premium status` - View subscription
- `/premium plans` - View available plans
- `/premium upgrade` - Upgrade subscription

---

## 🔧 Common Management Tasks

### Restart Services

```bash
# Restart specific service
docker-compose restart gateway

# Restart all services
docker-compose restart

# Full restart (rebuild)
docker-compose down
docker-compose up -d --build
```

### Update Code

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### View Resource Usage

```bash
# View CPU/Memory usage
docker stats

# View disk usage
docker system df
```

### Backup Database

```bash
# Create backup
docker-compose exec postgres pg_dump -U postgres discord > backup.sql

# Restore backup
docker-compose exec -T postgres psql -U postgres discord < backup.sql
```

### Clean Up

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes all data!)
docker-compose down -v

# Remove old images
docker image prune -a
```

---

## 🛠️ Troubleshooting

### Bot Not Appearing Online

**Check gateway logs**:
```bash
docker-compose logs gateway
```

**Common issues**:
- Invalid `DISCORD_TOKEN` in `.env`
- Bot not invited to server
- Missing intents in Discord Developer Portal

**Fix**:
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Go to "Bot" section
4. Enable these Privileged Gateway Intents:
   - ✅ Server Members Intent
   - ✅ Message Content Intent
5. Copy token and update `.env`
6. Restart: `docker-compose restart gateway`

### Music Not Playing

**Check audio and lavalink logs**:
```bash
docker-compose logs audio
docker-compose logs lavalink
```

**Common issues**:
- Lavalink not started
- Voice connection failed
- YouTube age restriction

**Fix**:
```bash
# Restart audio services
docker-compose restart audio lavalink

# Check health
curl http://localhost:2333/version
```

### Services Keep Restarting

**Check service status**:
```bash
docker-compose ps
docker-compose logs [service-name]
```

**Common issues**:
- Insufficient memory
- Database connection failed
- Environment variables missing

**Fix**:
1. Check Docker Desktop has enough memory allocated (Settings → Resources)
2. Verify `.env` file has all required variables
3. Check database: `docker-compose exec postgres pg_isready -U postgres`

### Out of Memory

**Increase Docker memory**:
- **Windows/Mac**: Docker Desktop → Settings → Resources → Memory → Increase to 6GB+
- **Linux**: Increase system swap or upgrade RAM

**Reduce service memory**:
Edit `docker-compose.yml` and reduce memory limits:
```yaml
deploy:
  resources:
    limits:
      memory: 256M  # Reduce from 512M
```

### Port Already in Use

**Find what's using the port**:
```bash
# Windows
netstat -ano | findstr :3000

# Linux/Mac
lsof -i :3000
```

**Fix**:
- Stop the conflicting service
- OR change port in `docker-compose.yml`:
  ```yaml
  ports:
    - "3100:3000"  # Use 3100 instead of 3000
  ```

---

## 🔒 Security Checklist

Before deploying to production:

- [ ] Change default `POSTGRES_PASSWORD` in `.env`
- [ ] Set strong `LAVALINK_PASSWORD` in `.env`
- [ ] Generate secure `WEBHOOK_SECRET` (if using webhooks)
- [ ] Don't expose ports publicly (use reverse proxy)
- [ ] Enable firewall rules (only allow necessary ports)
- [ ] Set up HTTPS with SSL/TLS (use Nginx/Caddy)
- [ ] Configure rate limiting
- [ ] Enable Sentry error tracking (optional)
- [ ] Set up automated backups
- [ ] Monitor resource usage

---

## 📊 Performance Optimization

### For Low-Resource Servers (2GB RAM)

```yaml
# Edit docker-compose.yml - reduce limits:

gateway:
  deploy:
    resources:
      limits:
        memory: 256M  # from 512M

audio:
  deploy:
    resources:
      limits:
        memory: 512M  # from 1G

postgres:
  deploy:
    resources:
      limits:
        memory: 1G  # from 2G
```

### For High-Traffic Servers

```bash
# Scale gateway and audio services
docker-compose up -d --scale gateway=3 --scale audio=2
```

---

## 📞 Getting Help

### Logs to Include When Reporting Issues

```bash
# Service status
docker-compose ps

# Recent logs from all services
docker-compose logs --tail=100 > logs.txt

# System information
docker info
docker-compose version
```

### Useful Resources

- **Documentation**: [docs/](docs/)
- **GitHub Issues**: Report bugs and request features
- **Discord Developer Portal**: [https://discord.com/developers](https://discord.com/developers)
- **Lavalink Docs**: [https://lavalink.dev](https://lavalink.dev)

---

## 🎉 Success!

Your Discord Music Bot is now running in production! 🎵

**What's Next?**
- Invite bot to more servers
- Configure premium features (optional)
- Set up monitoring dashboards (Grafana)
- Configure automated backups
- Set up reverse proxy with HTTPS

---

**Enjoy your music bot!** 🚀🎶

*Last updated: November 3, 2025*
