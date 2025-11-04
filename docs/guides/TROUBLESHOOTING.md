# 🔧 Troubleshooting Guide - Discord Music Bot

This comprehensive guide consolidates all troubleshooting information for common issues, errors, and problems you may encounter when deploying and running the Discord Music Bot.

## 📊 Quick Diagnosis Flowchart

```mermaid
graph TD
    A[Bot Issue] --> B{Bot Online?}
    B -->|No| C[Check Discord Connection]
    B -->|Yes| D{Commands Working?}

    C --> C1[Verify DISCORD_TOKEN]
    C --> C2[Check Gateway Logs]
    C --> C3[Verify Intents]

    D -->|No| E[Check Command Registration]
    D -->|Yes| F{Music Playing?}

    E --> E1[Re-register Commands]
    E --> E2[Check Permissions]

    F -->|No| G{Lavalink Connected?}
    F -->|Yes| H[Check Performance]

    G -->|No| I[Check Lavalink Service]
    G -->|Yes| J[Check Voice Permissions]

    I --> I1[Verify Lavalink Config]
    I --> I2[Check Port Connectivity]
    I --> I3[Review Lavalink Logs]

    J --> J1[Bot Voice Permissions]
    J --> J2[Voice Channel State]

    H --> H1[Memory Usage]
    H --> H2[CPU Load]
    H --> H3[Network Latency]
```

---

## 🚨 Common Error Messages

### Problem: "Discord.js Error: Invalid Token"

**Symptoms**:
- Bot fails to start
- Error message: `Error [TOKEN_INVALID]: An invalid token was provided`
- Gateway service crashes on startup

**Cause**:
- Invalid or expired Discord bot token
- Token copied incorrectly (extra spaces, incomplete)
- Bot token regenerated in Discord Developer Portal

**Solution**:
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application → Bot section
3. Click "Reset Token" to generate a new token
4. Copy the entire token (no extra spaces)
5. Update `.env` file:
   ```env
   DISCORD_TOKEN=your-new-token-here
   ```
6. Restart the gateway service:
   ```bash
   # Docker
   docker compose restart gateway

   # PM2
   pm2 restart discord-bot-gateway

   # Development
   pnpm --filter gateway dev
   ```

**Prevention**:
- Store tokens securely in `.env` files (never commit to git)
- Use environment variable management tools in production
- Document token rotation procedures

---

### Problem: "Application did not respond"

**Symptoms**:
- User sees "The application did not respond" in Discord
- Commands appear to time out after 3 seconds
- No error in logs

**Cause**:
- Command execution taking longer than 3 seconds
- Missing immediate interaction response
- Network latency between bot and Discord API

**Solution**:
1. Ensure immediate ephemeral response in commands:
   ```typescript
   await interaction.deferReply({ ephemeral: true });
   ```
2. Check Discord API latency:
   ```bash
   curl -w "@-" https://discord.com/api/v10/gateway
   ```
3. Review command execution time in logs
4. Optimize slow database queries or external API calls

**Prevention**:
- Always defer replies for commands that take >1 second
- Implement timeout handling in long-running operations
- Use background jobs for heavy processing

---

### Problem: "Cannot read property 'queue' of undefined"

**Symptoms**:
- Music commands fail with undefined errors
- Error: `Cannot read property 'queue' of undefined`
- Bot appears online but music doesn't work

**Cause**:
- Lavalink connection not established
- Player not created for the guild
- Race condition during player initialization

**Solution**:
1. Check Lavalink connectivity:
   ```bash
   curl http://localhost:2333/version
   ```
2. Verify Lavalink configuration in `.env`:
   ```env
   LAVALINK_HOST=lavalink
   LAVALINK_PORT=2333
   LAVALINK_PASSWORD=youshallnotpass
   ```
3. Check audio service logs:
   ```bash
   docker compose logs -f audio
   ```
4. Restart audio service:
   ```bash
   docker compose restart audio
   ```
5. Verify bot is in a voice channel before playing

**Prevention**:
- Add null checks before accessing player properties
- Implement proper player initialization guards
- Add health checks for Lavalink connection

---

### Problem: "YouTube: This video requires login"

**Symptoms**:
- Specific YouTube videos won't play
- Error in logs: "Sign in to confirm your age"
- Age-restricted or login-required content fails

**Cause**:
- Age-restricted content requires authentication
- YouTube's anti-bot measures
- Missing poToken/visitorData configuration

**Solution**:
1. **Option 1 - Generate poToken (Recommended)**:
   ```bash
   npm install -g youtube-po-token-generator
   youtube-po-token-generator
   ```
   Add to `.env`:
   ```env
   YOUTUBE_PO_TOKEN=your-po-token
   YOUTUBE_VISITOR_DATA=your-visitor-data
   ```

2. **Option 2 - Use OAuth (Risky)**:
   - Use burner YouTube account
   - Follow Lavalink logs for OAuth URL
   - Add refresh token to `.env`:
   ```env
   YOUTUBE_REFRESH_TOKEN=your-refresh-token
   ```

3. **Option 3 - Skip These Videos**:
   - Error classifier will auto-skip
   - No configuration needed
   - User gets "track skipped" notification

**Prevention**:
- Configure poToken for better compatibility
- Use multiple YouTube clients in Lavalink config
- Implement fallback to alternative sources (SoundCloud)

---

### Problem: "Connection timeout to Redis"

**Symptoms**:
- Services fail to start
- Error: `Error: connect ETIMEDOUT`
- Inter-service communication fails

**Cause**:
- Redis service not running
- Incorrect Redis URL configuration
- Network connectivity issues
- Firewall blocking Redis port

**Solution**:
1. **Check Redis service status**:
   ```bash
   # Docker
   docker compose ps redis
   docker compose logs redis

   # Standalone
   redis-cli ping
   ```

2. **Verify Redis URL in `.env`**:
   ```env
   # Docker deployment
   REDIS_URL=redis://redis:6379

   # Local development
   REDIS_URL=redis://localhost:6379

   # With password
   REDIS_URL=redis://:password@redis:6379
   ```

3. **Test Redis connectivity**:
   ```bash
   # From host
   redis-cli -h localhost -p 6379 ping

   # From container
   docker compose exec gateway sh -c "redis-cli -h redis -p 6379 ping"
   ```

4. **Restart Redis**:
   ```bash
   docker compose restart redis
   ```

**Prevention**:
- Use health checks in docker-compose.yml
- Implement connection retry logic with exponential backoff
- Monitor Redis memory usage and set maxmemory policies

---

### Problem: "Lavalink node is not available"

**Symptoms**:
- Music commands fail immediately
- Error: "No available Lavalink nodes"
- Audio service shows connection errors

**Cause**:
- Lavalink service not running
- Incorrect Lavalink configuration
- Port conflicts
- Lavalink crashed or out of memory

**Solution**:
1. **Check Lavalink service**:
   ```bash
   # Docker
   docker compose ps lavalink
   docker compose logs lavalink

   # Look for: "Lavalink is ready to accept connections"
   ```

2. **Verify Lavalink configuration**:
   ```bash
   # Check application.yml
   cat lavalink/application.yml

   # Verify password matches .env
   grep LAVALINK_PASSWORD .env
   ```

3. **Test Lavalink connectivity**:
   ```bash
   # Check version endpoint
   curl http://localhost:2333/version

   # Expected response: {"version":"4.x.x",...}
   ```

4. **Check Lavalink logs for errors**:
   ```bash
   docker compose logs lavalink | grep -i error
   ```

5. **Restart Lavalink with memory increase**:
   ```yaml
   # docker-compose.yml
   lavalink:
     environment:
       JAVA_OPTS: "-Xmx2G -Xms1G"  # Increase from 1G to 2G
   ```

**Prevention**:
- Monitor Lavalink memory usage
- Set appropriate JAVA_OPTS for your server
- Enable Lavalink health checks
- Use multiple Lavalink nodes for redundancy

---

### Problem: "Database migration failed"

**Symptoms**:
- Services fail to start
- Error: "Migration failed with exit code 1"
- Database connection errors

**Cause**:
- PostgreSQL not ready when migration runs
- Syntax errors in migration files
- Schema conflicts or locked tables
- Insufficient database permissions

**Solution**:
1. **Check PostgreSQL status**:
   ```bash
   docker compose ps postgres
   docker compose logs postgres
   ```

2. **Verify database connection**:
   ```bash
   docker compose exec postgres psql -U postgres -d discord -c "\dt"
   ```

3. **Run migrations manually**:
   ```bash
   # View migration status
   pnpm --filter @discord-bot/database prisma migrate status

   # Run pending migrations
   pnpm --filter @discord-bot/database prisma migrate deploy

   # Reset database (WARNING: Deletes all data)
   pnpm --filter @discord-bot/database prisma migrate reset
   ```

4. **Check DATABASE_URL format**:
   ```env
   # Correct format
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord

   # With special characters in password, use URL encoding
   DATABASE_URL=postgresql://postgres:p%40ssw0rd@postgres:5432/discord
   ```

**Prevention**:
- Use `depends_on` with health checks in docker-compose.yml
- Add retry logic in migration scripts
- Test migrations in staging environment first
- Keep migration files under version control

---

## 🌐 Network Connectivity Issues

### Problem: Redis Connection Pool Exhausted

**Symptoms**:
- Intermittent command failures
- Error: "All connections in the pool are in use"
- Slow response times

**Cause**:
- Too many concurrent requests
- Connection leaks not being closed
- Pool size too small for load

**Solution**:
1. Increase Redis connection pool:
   ```env
   REDIS_POOL_SIZE=20
   REDIS_POOL_MIN=5
   REDIS_POOL_MAX=30
   ```

2. Check for connection leaks:
   ```bash
   redis-cli info clients
   # Look at connected_clients count
   ```

3. Monitor connection usage:
   ```typescript
   // Add to your Redis client
   redisClient.on('error', (err) => {
     logger.error('Redis error:', err);
   });
   ```

4. Implement connection timeout:
   ```env
   REDIS_CONNECT_TIMEOUT=10000
   REDIS_COMMAND_TIMEOUT=5000
   ```

**Prevention**:
- Properly close Redis connections after use
- Implement connection pooling best practices
- Monitor connection metrics with Prometheus

---

### Problem: PostgreSQL Connection Refused

**Symptoms**:
- Services cannot connect to database
- Error: `connect ECONNREFUSED 127.0.0.1:5432`
- Health checks failing

**Cause**:
- PostgreSQL not listening on expected interface
- Wrong host in DATABASE_URL
- PostgreSQL not fully initialized

**Solution**:
1. **Check PostgreSQL is listening**:
   ```bash
   docker compose exec postgres netstat -tuln | grep 5432
   ```

2. **Verify host configuration**:
   ```env
   # Docker deployment (use service name)
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord

   # Local development (use localhost)
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/discord
   ```

3. **Wait for PostgreSQL initialization**:
   ```bash
   # Check readiness
   docker compose exec postgres pg_isready -U postgres

   # View initialization logs
   docker compose logs postgres | grep "ready to accept connections"
   ```

4. **Check postgresql.conf**:
   ```bash
   docker compose exec postgres cat /var/lib/postgresql/data/postgresql.conf | grep listen_addresses
   # Should be: listen_addresses = '*'
   ```

**Prevention**:
- Use Docker health checks with `start_period`
- Implement connection retry with exponential backoff
- Configure proper `depends_on` conditions in docker-compose.yml

---

### Problem: Lavalink WebSocket Connection Drops

**Symptoms**:
- Music stops playing randomly
- Error: "WebSocket connection closed"
- Player state becomes inconsistent

**Cause**:
- Network instability
- Lavalink memory issues
- Keep-alive timeout
- Load balancer timeout

**Solution**:
1. **Enable WebSocket keep-alive**:
   ```typescript
   // In lavalink client config
   nodes: [{
     host: 'lavalink',
     port: 2333,
     password: 'youshallnotpass',
     retryDelay: 3000,
     retryAmount: 5,
   }]
   ```

2. **Increase Lavalink resources**:
   ```yaml
   # docker-compose.yml
   lavalink:
     deploy:
       resources:
         limits:
           memory: 2G
           cpus: '2'
   ```

3. **Check network latency**:
   ```bash
   # From audio service to lavalink
   docker compose exec audio ping -c 5 lavalink
   ```

4. **Monitor Lavalink stats**:
   ```bash
   curl http://localhost:2333/v4/stats
   ```

**Prevention**:
- Implement automatic reconnection logic
- Use session resuming in Lavalink
- Monitor WebSocket connection health
- Deploy Lavalink close to bot services (same datacenter)

---

## 🎵 YouTube Playback Errors

### Problem: YouTube Quota Exceeded

**Symptoms**:
- All YouTube playback fails
- Error: "quotaExceeded"
- Works fine earlier in the day

**Cause**:
- Daily YouTube API quota exceeded (10,000 units)
- Too many search requests
- Heavy usage during peak hours

**Solution**:
1. **Implement caching for searches**:
   ```env
   CACHE_TTL_SEARCH_RESULTS=300  # 5 minutes
   ```

2. **Enable multiple YouTube clients** in `lavalink/application.yml`:
   ```yaml
   plugins:
     youtube:
       clients:
         - MUSIC
         - ANDROID_VR
         - WEB
         - WEB_EMBEDDED
   ```

3. **Use alternative sources**:
   - Enable SoundCloud fallback
   - Configure Spotify bridge
   - Use direct URLs instead of search

4. **Monitor quota usage**:
   - Check Google Cloud Console
   - Set up quota alerts
   - Request quota increase if needed

**Prevention**:
- Cache search results aggressively
- Implement rate limiting on search commands
- Use YouTube Music API instead of regular YouTube API
- Distribute load across multiple API keys (if available)

---

### Problem: "Video unavailable" for valid URLs

**Symptoms**:
- Some videos fail to play despite being playable in browser
- Error: "This video is unavailable"
- Works intermittently

**Cause**:
- Geographic restrictions (region blocking)
- YouTube bot detection
- IP-based blocking
- Temporary YouTube service issues

**Solution**:
1. **Configure multiple YouTube clients** (see above)

2. **Enable IP rotation** in `lavalink/application.yml`:
   ```yaml
   lavalink:
     server:
       httpConfig:
         proxyHost: "your-proxy-host"
         proxyPort: 8080
   ```

3. **Use poToken authentication**:
   ```env
   YOUTUBE_PO_TOKEN=your-token
   YOUTUBE_VISITOR_DATA=your-data
   ```

4. **Check YouTube status**:
   ```bash
   curl -I https://www.youtube.com/watch?v=VIDEO_ID
   ```

**Prevention**:
- Implement automatic source fallback (YouTube → SoundCloud)
- Use YouTube Music as primary source
- Monitor YouTube API status
- Configure user-agent rotation

---

### Problem: Audio quality is poor or stuttering

**Symptoms**:
- Music sounds distorted
- Frequent buffering
- Audio cuts out intermittently

**Cause**:
- Insufficient bandwidth
- Lavalink overloaded
- Discord voice region latency
- Incorrect opus encoding settings

**Solution**:
1. **Optimize Lavalink audio settings** in `application.yml`:
   ```yaml
   lavalink:
     server:
       bufferDurationMs: 400
       frameBufferDurationMs: 5000
       opusEncodingQuality: 10  # Max quality
       resamplingQuality: HIGH
       useSeekGhosting: true
   ```

2. **Check Lavalink CPU usage**:
   ```bash
   docker stats lavalink
   ```

3. **Verify Discord voice region**:
   - Use voice region closest to server
   - Test different regions in Discord server settings

4. **Increase Lavalink memory**:
   ```yaml
   environment:
     JAVA_OPTS: "-Xmx2G -Xms1G"
   ```

**Prevention**:
- Use quality encoding settings from the start
- Monitor Lavalink performance metrics
- Deploy in same region as Discord voice servers
- Use CDN for audio streaming if possible

---

## 🐳 Docker Problems

### Problem: Container fails health check

**Symptoms**:
- Container shows "unhealthy" status
- Service restarts repeatedly
- `docker compose ps` shows unhealthy services

**Cause**:
- Service not starting within health check window
- Health check endpoint not responding
- Service crashed but container still running
- Incorrect health check configuration

**Solution**:
1. **Check health check logs**:
   ```bash
   docker inspect discord-gateway --format='{{json .State.Health}}' | jq
   ```

2. **Test health endpoint manually**:
   ```bash
   # From host
   curl http://localhost:3001/health

   # From inside container
   docker compose exec gateway wget -q -O- http://localhost:3001/health
   ```

3. **Adjust health check timing**:
   ```yaml
   healthcheck:
     test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1"]
     interval: 30s
     timeout: 10s
     retries: 3
     start_period: 60s  # Increase if service takes long to start
   ```

4. **Check service logs for startup issues**:
   ```bash
   docker compose logs gateway
   ```

**Prevention**:
- Set appropriate `start_period` for slow-starting services
- Implement graceful startup with dependency waiting
- Use health check endpoints that verify all dependencies
- Monitor health check failures with alerts

---

### Problem: Docker build fails with "no space left on device"

**Symptoms**:
- Error during `docker compose build`
- Message: "no space left on device"
- Cannot create new containers

**Cause**:
- Docker disk space exhausted
- Too many unused images/containers
- Build cache consuming space
- Log files filling disk

**Solution**:
1. **Clean Docker system**:
   ```bash
   # Remove unused containers, networks, images
   docker system prune -a

   # Remove unused volumes (WARNING: deletes data)
   docker system prune -a --volumes
   ```

2. **Check disk usage**:
   ```bash
   docker system df
   docker system df -v  # Verbose output
   ```

3. **Clean build cache**:
   ```bash
   docker builder prune -a
   ```

4. **Increase Docker disk space**:
   - Docker Desktop → Settings → Resources → Disk image size
   - Increase to 50GB+ for development

5. **Move Docker data directory** (Linux):
   ```bash
   # Edit /etc/docker/daemon.json
   {
     "data-root": "/new/path/to/docker"
   }
   ```

**Prevention**:
- Regular cleanup of unused Docker resources
- Implement log rotation
- Monitor disk usage with alerts
- Use multi-stage builds to reduce image size

---

### Problem: Port conflicts preventing container startup

**Symptoms**:
- Error: "Bind for 0.0.0.0:3000 failed: port is already allocated"
- Container exits immediately after starting
- `docker compose up` fails

**Cause**:
- Another application using the same port
- Previous container not fully stopped
- Multiple bot instances running
- Host firewall rules

**Solution**:
1. **Find process using the port**:
   ```bash
   # Windows
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F

   # macOS/Linux
   lsof -i :3000
   kill -9 <PID>
   ```

2. **Change port mapping in docker-compose.yml**:
   ```yaml
   ports:
     - "3100:3000"  # Map to different host port
   ```

3. **Stop conflicting containers**:
   ```bash
   docker ps -a | grep discord
   docker stop $(docker ps -a -q --filter "name=discord")
   ```

4. **Update .env to use different ports**:
   ```env
   GATEWAY_HTTP_PORT=3101
   AUDIO_HTTP_PORT=3102
   API_HTTP_PORT=3100
   ```

**Prevention**:
- Use non-standard ports to avoid conflicts
- Document port allocations
- Use Docker networks for inter-service communication
- Implement port availability checks before starting

---

### Problem: Docker networking issues between containers

**Symptoms**:
- Services cannot communicate
- Error: "getaddrinfo ENOTFOUND redis"
- Timeouts when connecting between containers

**Cause**:
- Containers on different networks
- Wrong service name in connection strings
- Network driver issues
- DNS resolution problems

**Solution**:
1. **Verify all services on same network**:
   ```bash
   docker network inspect discord_discord-network
   ```

2. **Use service names, not localhost**:
   ```env
   # Correct (Docker)
   REDIS_URL=redis://redis:6379
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord

   # Wrong (will not work in Docker)
   REDIS_URL=redis://localhost:6379
   ```

3. **Test DNS resolution**:
   ```bash
   docker compose exec gateway nslookup redis
   docker compose exec gateway ping redis
   ```

4. **Recreate network**:
   ```bash
   docker compose down
   docker network prune
   docker compose up -d
   ```

**Prevention**:
- Always use service names in connection strings
- Define explicit networks in docker-compose.yml
- Use Docker's built-in DNS for service discovery
- Test connectivity after any network changes

---

### Problem: Docker volumes not persisting data

**Symptoms**:
- Database resets after restart
- Configuration changes disappear
- Uploaded files lost

**Cause**:
- Using bind mounts instead of named volumes
- Volume not properly mounted
- Permissions issues
- Volume deleted with `docker compose down -v`

**Solution**:
1. **Check volume status**:
   ```bash
   docker volume ls
   docker volume inspect discord_postgres_data
   ```

2. **Verify volume mounts**:
   ```bash
   docker compose config | grep -A 5 volumes
   ```

3. **Backup data before operations**:
   ```bash
   # Backup database
   docker compose exec postgres pg_dump -U postgres discord > backup.sql
   ```

4. **Restore from backup**:
   ```bash
   docker compose exec -T postgres psql -U postgres discord < backup.sql
   ```

5. **Fix permissions**:
   ```bash
   docker compose exec postgres chown -R postgres:postgres /var/lib/postgresql/data
   ```

**Prevention**:
- Always use named volumes for persistent data
- Never use `docker compose down -v` in production
- Implement regular backup procedures
- Document volume locations and backup strategies

---

## 🎤 Voice Connection Issues

### Problem: Bot joins voice channel but no audio plays

**Symptoms**:
- Bot successfully joins voice channel
- Shows as connected in Discord
- No sound comes out
- "Now Playing" UI appears but timer doesn't move

**Cause**:
- Voice connection established but player not connected to Lavalink
- Raw voice events not being forwarded (pre-Sept 2025 fix)
- Voice server/state update race condition
- Lavalink not receiving voice connection info

**Solution**:
1. **Verify raw events handler is active** (should be in logs):
   ```bash
   docker compose logs gateway | grep "Raw Discord events handler"
   ```

2. **Check player connection state**:
   ```bash
   docker compose logs audio | grep "player.connected"
   # Should show: player.connected = true
   ```

3. **Verify voice events are being forwarded**:
   ```bash
   docker compose logs gateway | grep "VOICE_"
   ```

4. **Check Lavalink voice connection**:
   ```bash
   curl http://localhost:2333/v4/sessions
   ```

5. **Restart audio service**:
   ```bash
   docker compose restart audio gateway
   ```

**Prevention**:
- Ensure you're running code after Sept 24, 2025 critical fix
- Monitor player connection status
- Implement connection state validation before playback
- Add reconnection logic for dropped voice connections

---

### Problem: Bot disconnects from voice immediately after joining

**Symptoms**:
- Bot joins voice channel
- Disconnects within 1-2 seconds
- Error: "Voice connection destroyed"

**Cause**:
- Bot missing CONNECT or SPEAK permissions
- Voice channel full
- User limit reached
- Voice region incompatibility

**Solution**:
1. **Check bot permissions**:
   ```javascript
   // Required permissions
   - CONNECT
   - SPEAK
   - VIEW_CHANNEL
   ```

2. **Verify channel status**:
   - Check user limit not reached
   - Ensure channel is not full
   - Verify bot role has channel access

3. **Check voice region compatibility**:
   ```bash
   # Test different voice regions in Discord server settings
   ```

4. **Review gateway logs for permission errors**:
   ```bash
   docker compose logs gateway | grep -i "permission\|denied"
   ```

**Prevention**:
- Assign bot appropriate permissions on server join
- Implement permission checking before join attempt
- Add user-friendly error messages for permission issues
- Document required permissions in bot invite link

---

### Problem: Audio lags or has high latency

**Symptoms**:
- Noticeable delay between command and playback
- Audio arrives 5-10 seconds late
- Progress bar doesn't match actual playback
- Stuttering or buffering

**Cause**:
- High network latency
- Overloaded Lavalink server
- Wrong Discord voice region
- Insufficient bandwidth

**Solution**:
1. **Check voice region latency**:
   ```bash
   # Ping Discord voice servers
   ping us-east.voice.discord.media
   ```

2. **Optimize Lavalink buffer settings**:
   ```yaml
   lavalink:
     server:
       bufferDurationMs: 400
       frameBufferDurationMs: 5000
   ```

3. **Monitor network latency**:
   ```bash
   docker compose exec audio ping discord.com
   ```

4. **Reduce concurrent streams**:
   - Limit max guilds if load is high
   - Scale horizontally with multiple bot instances

5. **Check Discord voice server status**:
   - https://discordstatus.com/

**Prevention**:
- Deploy bot geographically close to target audience
- Use voice regions closest to bot server
- Monitor latency metrics with Prometheus
- Implement automatic region selection

---

### Problem: Voice connection "stuck" - bot appears connected but inactive

**Symptoms**:
- Bot stays in voice channel indefinitely
- No audio playing
- Commands don't respond
- Bot shows as connected but idle

**Cause**:
- Queue ended and bot didn't disconnect
- Playback error without proper cleanup
- Event listener memory leak
- Disconnect timeout not configured

**Solution**:
1. **Check bot disconnect timeout**:
   ```typescript
   // In audio service config
   onEmptyQueue: {
     destroyAfterMs: 300000  // 5 minutes
   }
   ```

2. **Manually disconnect bot**:
   ```bash
   # Use /stop command in Discord
   # Or restart audio service
   docker compose restart audio
   ```

3. **Check for event listener leaks**:
   ```bash
   docker compose logs audio | grep "MaxListenersExceededWarning"
   ```

4. **Force cleanup stale connections**:
   ```bash
   docker compose restart gateway audio
   ```

**Prevention**:
- Implement automatic disconnect on empty queue
- Set reasonable timeout values
- Clean up event listeners properly
- Monitor active connections and alert on stale ones

---

## ⚡ Performance Issues

### Problem: High memory usage / Memory leaks

**Symptoms**:
- Memory usage grows over time
- Bot becomes slow and unresponsive
- Eventually crashes with "Out of memory"
- Docker container restarts frequently

**Cause**:
- Memory leaks in event listeners
- Cached data not being cleared
- Large message history in RAM
- Unclosed database connections
- Audio buffers not released

**Solution**:
1. **Monitor memory usage**:
   ```bash
   docker stats --no-stream
   ```

2. **Increase Node.js memory limit**:
   ```env
   NODE_OPTIONS=--max-old-space-size=2048
   ```

3. **Analyze memory heap**:
   ```bash
   # Take heap snapshot
   node --inspect gateway/dist/index.js
   # Connect with Chrome DevTools
   ```

4. **Check for event listener leaks**:
   ```bash
   docker compose logs | grep "MaxListenersExceeded"
   ```

5. **Clear caches periodically**:
   ```bash
   redis-cli FLUSHDB  # WARNING: Clears all cache
   ```

6. **Restart services on schedule**:
   ```bash
   # Add to cron
   0 3 * * * docker compose restart gateway audio
   ```

**Prevention**:
- Implement proper event listener cleanup
- Set TTL on all cached data
- Use streaming for large datasets
- Monitor memory metrics with Prometheus
- Implement automatic service restart on memory threshold

---

### Problem: High CPU usage

**Symptoms**:
- CPU consistently above 80%
- Bot responses very slow
- Docker stats show high CPU
- Server becomes unresponsive

**Cause**:
- Inefficient loops or recursion
- Excessive logging
- Database query N+1 problem
- Too many simultaneous operations
- Lavalink transcoding overhead

**Solution**:
1. **Identify CPU-intensive processes**:
   ```bash
   docker stats
   top -p $(pgrep node)
   ```

2. **Profile Node.js application**:
   ```bash
   node --prof gateway/dist/index.js
   node --prof-process isolate-*.log > processed.txt
   ```

3. **Optimize database queries**:
   ```typescript
   // Bad: N+1 query
   for (const track of tracks) {
     await db.track.findUnique({ where: { id: track.id } });
   }

   // Good: Single query
   await db.track.findMany({ where: { id: { in: trackIds } } });
   ```

4. **Reduce logging verbosity**:
   ```env
   LOG_LEVEL=info  # Change from debug
   ```

5. **Increase CPU allocation**:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'  # Increase CPU limit
   ```

**Prevention**:
- Write efficient algorithms and queries
- Use indexes on database queries
- Implement rate limiting on CPU-intensive operations
- Monitor CPU metrics and set alerts
- Use caching to reduce repeated calculations

---

### Problem: Slow command response times

**Symptoms**:
- Commands take 5+ seconds to respond
- "Thinking..." message appears for long time
- Users report bot is laggy
- Timeout errors

**Cause**:
- Slow database queries
- External API latency (YouTube, Spotify)
- Synchronous operations blocking event loop
- Insufficient server resources
- Network latency

**Solution**:
1. **Add database indexes**:
   ```sql
   CREATE INDEX idx_queue_guild ON queue(guild_id);
   CREATE INDEX idx_tracks_created ON tracks(created_at);
   ```

2. **Implement query caching**:
   ```typescript
   const cached = await cache.get(`queue:${guildId}`);
   if (cached) return cached;
   ```

3. **Use connection pooling**:
   ```env
   DATABASE_POOL_SIZE=20
   REDIS_POOL_SIZE=15
   ```

4. **Profile slow operations**:
   ```bash
   docker compose logs gateway | grep "duration"
   ```

5. **Defer long operations**:
   ```typescript
   await interaction.deferReply();
   // Perform long operation
   await interaction.editReply('Done!');
   ```

**Prevention**:
- Always defer replies for operations >1 second
- Cache frequently accessed data
- Use background jobs for heavy processing
- Monitor response time metrics
- Implement timeout warnings

---

### Problem: Database connection pool exhausted

**Symptoms**:
- Error: "Cannot acquire connection"
- Commands fail randomly
- Health checks failing intermittently

**Cause**:
- Too many concurrent database operations
- Connections not being released
- Pool size too small
- Long-running transactions

**Solution**:
1. **Increase pool size**:
   ```env
   DATABASE_POOL_SIZE=20
   DATABASE_POOL_TIMEOUT=20000
   ```

2. **Check active connections**:
   ```bash
   docker compose exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
   ```

3. **Find slow queries**:
   ```sql
   SELECT pid, now() - query_start AS duration, query
   FROM pg_stat_activity
   WHERE state = 'active'
   ORDER BY duration DESC;
   ```

4. **Kill long-running queries**:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'active'
   AND now() - query_start > interval '5 minutes';
   ```

**Prevention**:
- Always close connections after use
- Use connection pooling properly
- Set query timeout limits
- Monitor connection metrics
- Implement connection leak detection

---

## 💾 Database Problems

### Problem: Database migrations not running

**Symptoms**:
- Services start but fail on database operations
- Error: "Table does not exist"
- Schema mismatch errors

**Cause**:
- Migrations not executed during deployment
- Migration files missing
- Database locked during migration
- Permissions issues

**Solution**:
1. **Check migration status**:
   ```bash
   pnpm --filter @discord-bot/database prisma migrate status
   ```

2. **Run pending migrations**:
   ```bash
   pnpm --filter @discord-bot/database prisma migrate deploy
   ```

3. **Generate Prisma client**:
   ```bash
   pnpm --filter @discord-bot/database prisma generate
   ```

4. **Reset database (dev only)**:
   ```bash
   pnpm --filter @discord-bot/database prisma migrate reset
   ```

5. **Check migration files exist**:
   ```bash
   ls packages/database/prisma/migrations/
   ```

**Prevention**:
- Run migrations automatically in CI/CD
- Add migration check to health endpoint
- Version control all migration files
- Test migrations in staging first

---

### Problem: Database connection pool exhausted (Prisma)

**Symptoms**:
- Error: "Connection pool timeout"
- "Timed out fetching a connection from the pool"
- Operations hang indefinitely

**Cause**:
- Prisma connection pool too small
- Long-running queries
- Not closing Prisma client connections
- Too many concurrent operations

**Solution**:
1. **Increase connection pool size** in schema.prisma:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }

   generator client {
     provider = "prisma-client-js"
     previewFeatures = ["tracing"]
   }
   ```

2. **Update DATABASE_URL with pool settings**:
   ```env
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord?connection_limit=20&pool_timeout=20
   ```

3. **Check PostgreSQL max connections**:
   ```sql
   SHOW max_connections;
   ALTER SYSTEM SET max_connections = 100;
   ```

4. **Monitor active connections**:
   ```bash
   watch -n 1 'docker compose exec postgres psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"'
   ```

**Prevention**:
- Use singleton Prisma client instance
- Implement connection pooling properly
- Set appropriate timeout values
- Monitor pool usage metrics

---

### Problem: "Too many connections" PostgreSQL error

**Symptoms**:
- Error: "FATAL: sorry, too many clients already"
- New connections rejected
- Services unable to start

**Cause**:
- PostgreSQL max_connections reached
- Connection leaks
- Too many services/replicas
- Not closing connections

**Solution**:
1. **Check current connections**:
   ```sql
   SELECT count(*) FROM pg_stat_activity;
   SELECT usename, count(*) FROM pg_stat_activity GROUP BY usename;
   ```

2. **Increase max_connections**:
   ```bash
   docker compose exec postgres psql -U postgres -c "ALTER SYSTEM SET max_connections = 200;"
   docker compose restart postgres
   ```

3. **Kill idle connections**:
   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE state = 'idle'
   AND state_change < now() - interval '5 minutes';
   ```

4. **Configure connection pooling**:
   ```env
   DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord?connection_limit=10
   ```

**Prevention**:
- Use connection pooling (PgBouncer)
- Set proper connection limits per service
- Implement connection timeout
- Monitor connection usage
- Close connections after use

---

## 🏥 Health Check Failures

### Problem: Health endpoint returns 503

**Symptoms**:
- `/health` endpoint returns 503 Service Unavailable
- Docker health checks failing
- Load balancer marks service as down

**Cause**:
- Service not fully initialized
- Dependencies (Redis, PostgreSQL, Lavalink) not reachable
- Health check logic too strict
- Service actually unhealthy

**Solution**:
1. **Check service logs**:
   ```bash
   docker compose logs gateway | grep -i health
   ```

2. **Test dependencies manually**:
   ```bash
   # Redis
   docker compose exec redis redis-cli ping

   # PostgreSQL
   docker compose exec postgres pg_isready -U postgres

   # Lavalink
   curl http://localhost:2333/version
   ```

3. **Simplify health check temporarily**:
   ```typescript
   // Return OK without dependency checks
   app.get('/health', (req, res) => {
     res.json({ status: 'ok', timestamp: new Date().toISOString() });
   });
   ```

4. **Add detailed health response**:
   ```typescript
   app.get('/health', async (req, res) => {
     const health = {
       status: 'ok',
       redis: await checkRedis(),
       database: await checkDatabase(),
       lavalink: await checkLavalink(),
     };
     const allHealthy = Object.values(health).every(v => v === true);
     res.status(allHealthy ? 200 : 503).json(health);
   });
   ```

**Prevention**:
- Implement graceful degradation
- Use separate liveness and readiness probes
- Add timeout to health check operations
- Log health check failures for debugging
- Monitor health check response times

---

### Problem: Service marked healthy but not functioning

**Symptoms**:
- Health check returns 200 OK
- But actual functionality doesn't work
- Commands fail despite healthy status

**Cause**:
- Health check too simple (only checks HTTP server)
- Doesn't verify dependencies
- Doesn't test actual functionality
- Race condition in initialization

**Solution**:
1. **Enhance health check to verify dependencies**:
   ```typescript
   app.get('/health', async (req, res) => {
     try {
       // Test Redis
       await redis.ping();

       // Test Database
       await prisma.$queryRaw`SELECT 1`;

       // Test Lavalink (if audio service)
       if (lavalinkManager) {
         const connected = lavalinkManager.nodes.some(n => n.connected);
         if (!connected) throw new Error('No Lavalink nodes connected');
       }

       res.json({
         status: 'healthy',
         timestamp: new Date().toISOString(),
         uptime: process.uptime()
       });
     } catch (error) {
       res.status(503).json({
         status: 'unhealthy',
         error: error.message
       });
     }
   });
   ```

2. **Add readiness check separate from liveness**:
   ```typescript
   // Liveness: Is process running?
   app.get('/health/live', (req, res) => {
     res.json({ status: 'alive' });
   });

   // Readiness: Can it handle requests?
   app.get('/health/ready', async (req, res) => {
     const ready = await checkAllDependencies();
     res.status(ready ? 200 : 503).json({ ready });
   });
   ```

3. **Use both checks in kubernetes**:
   ```yaml
   livenessProbe:
     httpGet:
       path: /health/live
       port: 3001
   readinessProbe:
     httpGet:
       path: /health/ready
       port: 3001
   ```

**Prevention**:
- Always check critical dependencies in health endpoint
- Use separate liveness and readiness probes
- Test health checks during deployment
- Add metrics for health check failures
- Document what each health check verifies

---

## 📋 Configuration Issues

### Problem: Environment variables not loading

**Symptoms**:
- Services start with default/wrong configuration
- Error: "Required environment variable missing"
- Bot token not found

**Cause**:
- `.env` file not in correct location
- Syntax errors in `.env` file
- Docker not loading env file
- Variable names misspelled

**Solution**:
1. **Verify .env file location**:
   ```bash
   # Should be in project root
   ls -la .env
   cat .env
   ```

2. **Check .env syntax**:
   ```env
   # Correct
   DISCORD_TOKEN=your-token-here

   # Wrong (no spaces, no quotes unless value contains spaces)
   DISCORD_TOKEN = "your-token-here"
   ```

3. **Verify docker-compose loads .env**:
   ```yaml
   services:
     gateway:
       env_file: .env  # Must be present
   ```

4. **Test env loading**:
   ```bash
   docker compose config | grep DISCORD_TOKEN
   ```

5. **Check for Windows line endings**:
   ```bash
   # Convert CRLF to LF
   dos2unix .env
   ```

**Prevention**:
- Use `.env.example` as template
- Validate .env on startup
- Log loaded configuration (without secrets)
- Use schema validation (Zod)
- Document all required variables

---

### Problem: Config validation fails

**Symptoms**:
- Error: "Invalid configuration"
- Services fail to start
- Zod validation errors

**Cause**:
- Missing required environment variables
- Wrong data type (string vs number)
- Invalid URL format
- Out of range values

**Solution**:
1. **Check validation error details**:
   ```bash
   docker compose logs gateway | grep -A 10 "validation"
   ```

2. **Verify all required variables present**:
   ```bash
   # Check against .env.example
   diff <(sort .env.example | grep -v '^#' | cut -d= -f1) \
        <(sort .env | grep -v '^#' | cut -d= -f1)
   ```

3. **Fix data type issues**:
   ```env
   # Wrong
   LAVALINK_PORT="2333"  # String

   # Correct
   LAVALINK_PORT=2333    # Number
   ```

4. **Validate URLs**:
   ```env
   # Must be valid URL format
   DATABASE_URL=postgresql://user:pass@host:5432/db
   REDIS_URL=redis://host:6379
   ```

**Prevention**:
- Use config schema validation (Zod)
- Provide clear error messages
- Document expected formats
- Validate on startup before connecting
- Use TypeScript for type safety

---

## 🎯 Command Registration Issues

### Problem: Slash commands not appearing in Discord

**Symptoms**:
- Type `/` but no bot commands show
- Commands worked before but disappeared
- Other bots' commands work fine

**Cause**:
- Commands not registered with Discord API
- Wrong application ID
- Bot not in server
- Discord API caching
- Registration scope issue (global vs guild)

**Solution**:
1. **Check bot is in server and online**:
   - Verify bot shows as online in Discord
   - Check member list

2. **Re-register commands manually**:
   ```bash
   # Development (guild-specific, instant)
   pnpm --filter gateway run register-commands --guild YOUR_GUILD_ID

   # Production (global, takes up to 1 hour)
   pnpm --filter gateway run register-commands --global
   ```

3. **Verify application ID**:
   ```bash
   # Check .env
   grep DISCORD_APPLICATION_ID .env

   # Should match Discord Developer Portal
   ```

4. **Check registration logs**:
   ```bash
   docker compose logs gateway | grep "Successfully registered"
   ```

5. **Force Discord to refresh**:
   - Restart Discord client
   - Use Ctrl+R to reload
   - Wait up to 1 hour for global commands

**Prevention**:
- Use guild commands for development (instant updates)
- Use global commands for production
- Log command registration success/failure
- Verify correct scope in COMMANDS_SCOPE env var
- Document registration process

---

## 🎉 Successfully Resolved!

If your issue was resolved:

1. **Document the solution** - Help others by contributing to this guide
2. **Monitor for recurrence** - Set up alerts to catch it early
3. **Update runbooks** - Add to team documentation
4. **Share knowledge** - Help community members with similar issues

## 📚 Additional Resources

- **Architecture Documentation**: [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- **Configuration Guide**: [docs/CONFIGURATION.md](../CONFIGURATION.md)
- **Development Guide**: [docs/DEVELOPMENT_GUIDE.md](../DEVELOPMENT_GUIDE.md)
- **Docker Guide**: [DOCKER_README.md](../../DOCKER_README.md)
- **Windows Quick Start**: [WINDOWS_QUICKSTART.md](../../WINDOWS_QUICKSTART.md)
- **Discord.js Guide**: https://discordjs.guide/
- **Lavalink Documentation**: https://lavalink.dev/

## 🆘 Getting Help

If none of these solutions work:

1. **Gather diagnostic information**:
   ```bash
   # Collect logs
   docker compose logs > logs.txt

   # Get system info
   docker version > system-info.txt
   docker compose ps >> system-info.txt
   docker stats --no-stream >> system-info.txt

   # Check configuration (remove secrets first!)
   docker compose config > config.yml
   ```

2. **Search existing issues**: Check GitHub issues for similar problems

3. **Create detailed issue** with:
   - Clear description of problem
   - Steps to reproduce
   - Expected vs actual behavior
   - Logs and error messages
   - System information
   - Configuration (sanitized)

4. **Community support**:
   - Discord server (if available)
   - GitHub Discussions
   - Stack Overflow

---

**Total Issues Documented: 58**

This troubleshooting guide covers common error messages, network connectivity, YouTube playback, Docker problems, voice connections, performance issues, database problems, health checks, and configuration issues with detailed solutions and prevention strategies.
