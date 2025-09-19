# 🔧 Troubleshooting Guide - Discord Music Bot

## 🚨 **Quick Diagnostics**

### Health Check Commands
```bash
# Check all services
curl http://localhost:3001/health  # Gateway
curl http://localhost:3002/health  # Audio
curl http://localhost:3000/health  # API
curl http://localhost:2333/version # Lavalink

# Docker service status
docker-compose ps
docker-compose logs -f [service-name]
```

### Service Status Indicators
- 🟢 **Healthy**: All systems operational
- 🟡 **Degraded**: Some non-critical issues
- 🔴 **Unhealthy**: Critical systems down

## 🤖 **Discord Bot Issues**

### **Bot Appears Offline**

#### Symptoms
- Bot shows as offline in Discord
- Slash commands don't appear
- No response to commands

#### Diagnosis
```bash
# Check gateway service
docker-compose logs gateway

# Check Discord connection
grep "Discord client ready" logs
grep "Failed to login" logs
```

#### Solutions
1. **Invalid Token**:
   ```bash
   # Verify token in .env
   echo $DISCORD_TOKEN
   # Regenerate token in Discord Developer Portal
   ```

2. **Wrong Intents**:
   ```bash
   # Required intents in code:
   # - GatewayIntentBits.Guilds
   # - GatewayIntentBits.GuildVoiceStates
   # - GatewayIntentBits.GuildMessages
   ```

3. **Network Issues**:
   ```bash
   # Test Discord connectivity
   curl https://discord.com/api/v10/gateway

   # Check firewall/proxy
   ping discord.com
   ```

### **Slash Commands Not Appearing**

#### Symptoms
- Commands don't show up in Discord
- `/play` command missing
- "Application did not respond" errors

#### Solutions
1. **Registration Issues**:
   ```bash
   # Check APPLICATION_ID is correct
   echo $DISCORD_APPLICATION_ID

   # Manually register commands (development)
   cd gateway && node scripts/register-commands.js
   ```

2. **Global vs Guild Commands**:
   ```bash
   # Global commands take up to 1 hour
   # Guild commands are instant (for testing)
   # Set TEST_GUILD_ID for development
   ```

3. **Permissions**:
   ```bash
   # Bot needs these OAuth2 scopes:
   # - bot
   # - applications.commands
   ```

### **Bot Responds But No Audio**

#### Symptoms
- Commands work but no music plays
- "Failed to connect to voice channel"
- Audio cuts out frequently

#### Diagnosis
```bash
# Check audio service
curl http://localhost:3002/health

# Check Lavalink
curl http://localhost:2333/version

# Check voice connection
docker-compose logs audio | grep "voice"
```

#### Solutions
1. **Lavalink Issues**:
   ```bash
   # Restart Lavalink
   docker-compose restart lavalink

   # Check Lavalink logs
   docker-compose logs lavalink | grep -i error

   # Verify plugins loaded
   curl http://localhost:2333/plugins
   ```

2. **Voice Permissions**:
   ```bash
   # Bot needs permissions in voice channel:
   # - Connect
   # - Speak
   # - Use Voice Activity
   ```

3. **Audio Source Issues**:
   ```bash
   # Test YouTube search
   curl "http://localhost:2333/v4/loadtracks?identifier=ytsearch:test"

   # Check plugin status
   docker-compose logs lavalink | grep "Plugin loaded"
   ```

## 🗄️ **Database Issues**

### **Connection Failed**

#### Symptoms
- "Database connection failed" errors
- Prisma client errors
- Migration failures

#### Diagnosis
```bash
# Check PostgreSQL container
docker-compose ps postgres

# Test connection
docker-compose exec postgres psql -U postgres -d discord_bot -c "SELECT 1;"

# Check connection string
echo $DATABASE_URL
```

#### Solutions
1. **PostgreSQL Not Running**:
   ```bash
   # Start PostgreSQL
   docker-compose up -d postgres

   # Check logs
   docker-compose logs postgres
   ```

2. **Wrong Connection String**:
   ```bash
   # Format: postgresql://user:password@host:port/database
   # Example: postgresql://postgres:password@localhost:5432/discord_bot

   # Test locally
   DATABASE_URL="postgresql://postgres:password@localhost:5432/discord_bot" pnpm --filter @discord-bot/database prisma db push
   ```

3. **Migration Issues**:
   ```bash
   # Reset database (DESTRUCTIVE)
   pnpm --filter @discord-bot/database prisma migrate reset

   # Apply migrations
   pnpm db:migrate

   # Generate client
   pnpm --filter @discord-bot/database prisma:generate
   ```

### **Slow Database Performance**

#### Symptoms
- Slow command responses
- Timeout errors
- High database CPU

#### Solutions
```bash
# Check connection pool
grep "database_connections_active" metrics

# Optimize queries
grep "slow query" logs

# Add indexes (if needed)
pnpm --filter @discord-bot/database prisma db push
```

## 🔴 **Redis Issues**

### **Redis Connection Failed**

#### Symptoms
- Rate limiting not working
- Cache misses
- Pub/sub messages not delivered

#### Diagnosis
```bash
# Check Redis container
docker-compose ps redis

# Test connection
docker-compose exec redis redis-cli ping

# Check memory usage
docker-compose exec redis redis-cli info memory
```

#### Solutions
1. **Redis Not Running**:
   ```bash
   # Start Redis
   docker-compose up -d redis

   # Check configuration
   docker-compose exec redis redis-cli config get "*"
   ```

2. **Memory Issues**:
   ```bash
   # Check memory usage
   docker-compose exec redis redis-cli info memory

   # Clear cache (if needed)
   docker-compose exec redis redis-cli flushall
   ```

3. **Connection Pool**:
   ```bash
   # Check Redis connections
   docker-compose exec redis redis-cli client list

   # Monitor commands
   docker-compose exec redis redis-cli monitor
   ```

## 🎵 **Audio Service Issues**

### **Lavalink Connection Issues**

#### Symptoms
- "No available nodes" errors
- Audio doesn't start
- Frequent disconnections

#### Diagnosis
```bash
# Check Lavalink health
curl http://localhost:2333/version

# Check audio service connection
curl http://localhost:3002/health

# Monitor Lavalink logs
docker-compose logs lavalink | grep -i "error\|warn"
```

#### Solutions
1. **Lavalink Not Ready**:
   ```bash
   # Wait for Lavalink startup (can take 30s)
   # Check plugins loading
   docker-compose logs lavalink | grep "Plugin"

   # Restart if stuck
   docker-compose restart lavalink
   ```

2. **Password Mismatch**:
   ```bash
   # Check password in lavalink/application.yml
   # Must match LAVALINK_PASSWORD in .env

   # Test connection
   curl -H "Authorization: youshallnotpass" http://localhost:2333/version
   ```

3. **Plugin Issues**:
   ```bash
   # Check YouTube plugin
   curl http://localhost:2333/plugins | grep -i youtube

   # Verify plugin configuration in application.yml
   ```

### **Audio Quality Issues**

#### Symptoms
- Poor audio quality
- Choppy playback
- Buffering issues

#### Solutions
```bash
# Check Lavalink configuration
# In lavalink/application.yml:
# opusEncodingQuality: 10 (max quality)
# frameBufferDurationMs: 5000
# bufferDurationMs: 400

# Monitor network latency
ping discord.com

# Check system resources
docker stats
```

## 🐳 **Docker Issues**

### **Build Failures**

#### Symptoms
- Docker build stops with errors
- "No space left on device"
- Package installation failures

#### Solutions
```bash
# Clean Docker cache
docker system prune -a

# Check disk space
df -h

# Rebuild with verbose output
docker-compose build --no-cache gateway

# Check build logs
docker-compose logs --no-color > build.log
```

### **Container Startup Issues**

#### Symptoms
- Services immediately exit
- Health checks failing
- Port binding errors

#### Solutions
```bash
# Check port conflicts
netstat -tulpn | grep :3001

# View container logs
docker-compose logs [service-name]

# Check resource limits
docker stats

# Restart problematic service
docker-compose restart [service-name]
```

### **Network Issues**

#### Symptoms
- Services can't communicate
- External connections fail
- DNS resolution errors

#### Solutions
```bash
# Check Docker network
docker network ls
docker network inspect discord_bot_default

# Test inter-service communication
docker-compose exec gateway ping postgres
docker-compose exec gateway ping redis

# Check external connectivity
docker-compose exec gateway ping google.com
```

## 📊 **Performance Issues**

### **High Memory Usage**

#### Symptoms
- OOM (Out of Memory) errors
- Slow performance
- Container restarts

#### Diagnosis
```bash
# Monitor memory usage
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Check application metrics
curl http://localhost:3001/metrics | grep memory

# Node.js heap dump (if needed)
docker-compose exec gateway node --inspect=0.0.0.0:9229 src-legacy/index.js
```

#### Solutions
```bash
# Increase container memory limits
# In docker-compose.yml:
# deploy:
#   resources:
#     limits:
#       memory: 2G

# Optimize Node.js heap
# Add to Dockerfile:
# ENV NODE_OPTIONS="--max-old-space-size=1024"

# Clear caches
docker-compose exec redis redis-cli flushall
```

### **High CPU Usage**

#### Symptoms
- Slow response times
- High container CPU usage
- System overload

#### Solutions
```bash
# Identify CPU hotspots
docker stats
top -p $(pgrep node)

# Check for infinite loops
docker-compose logs gateway | grep -i "error\|loop"

# Scale horizontally
docker-compose up --scale gateway=2
```

## 🔍 **Monitoring & Debugging**

### **Enable Debug Mode**
```bash
# Set debug environment
echo "LOG_LEVEL=debug" >> .env.docker
docker-compose restart

# Enable Node.js debugging
NODE_OPTIONS="--inspect=0.0.0.0:9229" node src-legacy/index.js

# Monitor real-time logs
docker-compose logs -f --tail=100
```

### **Collect Diagnostics**
```bash
# Generate diagnostic report
./scripts/collect-diagnostics.sh

# Health check summary
curl -s http://localhost:3001/health | jq
curl -s http://localhost:3002/health | jq
curl -s http://localhost:3000/health | jq

# System information
docker version
docker-compose version
docker system info
```

### **Performance Profiling**
```bash
# Enable Prometheus metrics
curl http://localhost:3001/metrics
curl http://localhost:3002/metrics

# Grafana dashboards
# Access: http://localhost:3300 (admin/admin)

# OpenTelemetry tracing
# Check distributed tracing in logs
```

## 🚨 **Emergency Procedures**

### **Complete System Reset**
```bash
# WARNING: This will destroy all data
docker-compose down -v
docker system prune -a
docker volume prune
rm -rf node_modules
pnpm install
docker-compose up -d
```

### **Rollback to Last Working Version**
```bash
# Stop current deployment
docker-compose down

# Checkout last working commit
git log --oneline -10
git checkout [commit-hash]

# Rebuild and deploy
docker-compose build
docker-compose up -d
```

### **Backup Critical Data**
```bash
# Backup database
docker-compose exec postgres pg_dump -U postgres discord_bot > backup.sql

# Backup configuration
cp .env .env.backup
cp -r lavalink/application.yml lavalink/application.yml.backup

# Export Docker volumes
docker run --rm -v discord_bot_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

## 📞 **Getting Help**

### **Log Collection**
```bash
# Collect all logs
mkdir -p debug-logs
docker-compose logs --no-color gateway > debug-logs/gateway.log
docker-compose logs --no-color audio > debug-logs/audio.log
docker-compose logs --no-color postgres > debug-logs/postgres.log
docker-compose logs --no-color redis > debug-logs/redis.log
docker-compose logs --no-color lavalink > debug-logs/lavalink.log

# System information
docker system info > debug-logs/docker-info.txt
docker-compose config > debug-logs/compose-config.yml
```

### **Common Solutions Checklist**
- [ ] All containers running (`docker-compose ps`)
- [ ] Health checks passing (all services green)
- [ ] Discord token valid and bot invited to server
- [ ] Environment variables correctly set
- [ ] Ports not conflicting with other services
- [ ] Sufficient system resources (RAM, disk, CPU)
- [ ] Network connectivity to Discord and external services
- [ ] Database migrations applied
- [ ] Lavalink plugins loaded

### **Support Resources**
- Check [PROJECT_STATUS.md](./PROJECT_STATUS.md) for known issues
- Review [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
- Examine [METRICS.md](./METRICS.md) for monitoring details
- Search existing issues in repository
- Enable debug logging for detailed troubleshooting

**Remember: The Legacy implementation (`gateway/src-legacy/`) is the most stable for troubleshooting!** 🛠️