# ⚙️ Configuration Reference - Discord Music Bot

## **Configuration Status**

This guide provides comprehensive documentation for all configuration options, environment variables, and settings required for deployment.

## 📋 **Configuration Overview**

This guide provides comprehensive documentation for all configuration options, environment variables, and settings required for setting up and deploying a Discord music bot.

---

## 🌍 **Environment Variables**

### **Core Discord Configuration**

#### **Required Variables**
```env
# Discord Bot Credentials (REQUIRED)
DISCORD_TOKEN=<your_discord_token>
DISCORD_APPLICATION_ID=<your_application_id>

# Optional: Development Guild (for faster command registration)
DISCORD_GUILD_ID=<your_test_guild_id>
```

**Where to Get These Values:**
1. **Discord Token**: Discord Developer Portal → Your Application → Bot → Token
2. **Application ID**: Discord Developer Portal → Your Application → General Information → Application ID
3. **Guild ID**: Right-click your Discord server → Copy Server ID (Developer Mode enabled)

#### **Discord Configuration Options**
```env
# Bot Behavior
DISCORD_CLIENT_INTENTS=32767                    # All intents (default)
DISCORD_MAX_SHARD_COUNT=1                       # Number of shards (auto-detect)
DISCORD_PRESENCE_STATUS=online                  # online, idle, dnd, invisible
DISCORD_PRESENCE_ACTIVITY=Listening to music   # Bot status message
DISCORD_COMMAND_PREFIX=!                        # Legacy prefix (for text commands)

# API Configuration
DISCORD_API_VERSION=10                          # Discord API version
DISCORD_REST_TIMEOUT=15000                      # REST API timeout (ms)
DISCORD_WS_LARGE_THRESHOLD=50                   # Large guild threshold
```

### **Lavalink Audio Server Configuration**

#### **Connection Settings**
```env
# Lavalink Server (REQUIRED for music functionality)
LAVALINK_HOST=<lavalink_host>                # Lavalink server host
LAVALINK_PORT=<lavalink_port>                              # Lavalink server port
LAVALINK_PASSWORD=<lavalink_password>        # Lavalink server password
LAVALINK_SECURE=false                           # Use SSL connection
LAVALINK_IDENTIFIER=your-bot-identifier         # Node identifier

# Advanced Lavalink Options
LAVALINK_RESUME_KEY=your-resume-key             # Resume session key
LAVALINK_RESUME_TIMEOUT=60                      # Resume timeout (seconds)
LAVALINK_RECONNECT_DELAY=5000                   # Reconnection delay (ms)
LAVALINK_RECONNECT_TRIES=5                      # Max reconnection attempts
```

#### **Audio Quality Settings**
```env
# Audio Configuration
LAVALINK_VOLUME_DEFAULT=50                      # Default volume (0-200)
LAVALINK_VOLUME_MAX=200                         # Maximum volume limit
LAVALINK_SEARCH_PROVIDERS=youtube,soundcloud    # Enabled search providers
LAVALINK_AUTO_PLAY=true                         # Enable autoplay system
LAVALINK_SPONSORBLOCK=true                      # Enable SponsorBlock integration
```

### **Database Configuration**

#### **PostgreSQL Settings**
```env
# Database Connection (REQUIRED)
DATABASE_URL=postgresql://<username>:<password>@<hostname>:<db_port>/database_name

# Connection Pool Settings
DATABASE_POOL_SIZE=10                           # Connection pool size
DATABASE_POOL_TIMEOUT=20000                     # Pool acquire timeout (ms)
DATABASE_IDLE_TIMEOUT=10000                     # Idle connection timeout (ms)
DATABASE_MAX_LIFETIME=3600000                   # Max connection lifetime (ms)

# Development Options
DATABASE_LOGGING=false                          # Enable query logging
DATABASE_SLOW_QUERY_THRESHOLD=2000              # Slow query logging (ms)
DATABASE_SSL=false                              # Require SSL connection
```

#### **Database Migration Settings**
```env
# Migration Configuration
DATABASE_MIGRATE_ON_START=true                  # Auto-run migrations
DATABASE_SEED_ON_START=false                    # Auto-seed data (dev only)
DATABASE_RESET_ON_START=false                   # Reset database (dev only)
```

### **Redis Configuration**

#### **Connection Settings**
```env
# Redis Connection (REQUIRED for microservices)
REDIS_URL=redis://<hostname>:<redis_port>                # Redis connection string
REDIS_DB=0                                     # Redis database number
REDIS_PASSWORD=<redis_password>             # Redis password (if required)

# Advanced Redis Options
REDIS_CONNECT_TIMEOUT=10000                    # Connection timeout (ms)
REDIS_COMMAND_TIMEOUT=5000                     # Command timeout (ms)
REDIS_RETRY_DELAY_ON_FAILURE=100               # Retry delay (ms)
REDIS_MAX_RETRIES_PER_REQUEST=3                # Max retry attempts

# Connection Pool
REDIS_POOL_SIZE=10                             # Connection pool size
REDIS_POOL_MIN=2                               # Minimum pool connections
REDIS_POOL_MAX=20                              # Maximum pool connections
```

#### **Caching Configuration**
```env
# Cache TTL Settings (seconds)
CACHE_TTL_SEARCH_RESULTS=300                   # Search results cache (5 minutes)
CACHE_TTL_GUILD_CONFIG=300                     # Guild configuration cache (5 minutes)
CACHE_TTL_QUEUE_DATA=30                        # Queue data cache (30 seconds)
CACHE_TTL_USER_PROFILE=600                     # User profile cache (10 minutes)

# Cache Behavior
CACHE_ENABLED=true                             # Enable caching system
CACHE_COMPRESS=true                            # Compress cached data
CACHE_MAX_MEMORY=128MB                         # Max memory usage
```

### **Application Configuration**

#### **Service Ports**
```env
# Service Port Configuration
PORT_GATEWAY=<gateway_port>                              # Discord gateway service
PORT_AUDIO=<audio_port>                                # Audio processing service
PORT_API=<api_port>                                  # REST API service
PORT_WORKER=<worker_port>                               # Background worker service
PORT_HEALTH=<health_port>                               # Health check endpoint
```

#### **Environment and Deployment**
```env
# Environment Settings
NODE_ENV=production                            # Environment (development, production, test)
LOG_LEVEL=info                                 # Logging level (debug, info, warn, error)
DEBUG=your-bot:*                             # Debug namespaces
TZ=UTC                                         # Timezone

# Performance Tuning
NODE_OPTIONS=--max-old-space-size=2048         # Node.js memory limit (MB)
UV_THREADPOOL_SIZE=16                          # libuv thread pool size
MAX_CONCURRENT_REQUESTS=100                    # Max concurrent requests
REQUEST_TIMEOUT=30000                          # Request timeout (ms)
```

### **Security Configuration**

#### **Rate Limiting**
```env
# Rate Limiting Settings
RATE_LIMIT_WINDOW=60000                        # Rate limit window (ms)
RATE_LIMIT_MAX_REQUESTS=30                     # Max requests per window
RATE_LIMIT_SKIP_SUCCESSFUL=false               # Skip successful requests
RATE_LIMIT_SKIP_FAILED=false                   # Skip failed requests

# Command-Specific Rate Limits
RATE_LIMIT_PLAY_COMMAND=10                     # Play command limit per minute
RATE_LIMIT_SKIP_COMMAND=20                     # Skip command limit per minute
RATE_LIMIT_QUEUE_COMMAND=5                     # Queue command limit per minute
```

#### **CORS and Security**
```env
# CORS Configuration
CORS_ORIGINS=https://<your-domain.com>,https://app.<your-domain.com>
CORS_CREDENTIALS=true                          # Allow credentials
CORS_MAX_AGE=86400                             # Preflight cache time (seconds)

# Security Headers
SECURITY_HELMET_ENABLED=true                   # Enable Helmet.js
SECURITY_CSRF_ENABLED=false                    # Enable CSRF protection
SECURITY_API_KEY=<your_api_key>           # API authentication key
```

### **Monitoring and Observability**

#### **Logging Configuration**
```env
# Logging Settings
LOG_FORMAT=json                                # Log format (json, pretty)
LOG_COLORIZE=false                             # Colorize console output
LOG_TIMESTAMP=true                             # Include timestamps
LOG_ERRORS_ONLY=false                          # Log only errors

# File Logging
LOG_FILE_ENABLED=true                          # Enable file logging
LOG_FILE_PATH=./logs/app.log                   # Log file path
LOG_FILE_MAX_SIZE=10MB                         # Max log file size
LOG_FILE_MAX_FILES=5                           # Max log file rotation

# External Logging
SENTRY_DSN=                                    # Sentry error tracking DSN
SENTRY_ENVIRONMENT=production                  # Sentry environment
SENTRY_RELEASE=1.0.0                           # Application version
```

#### **Metrics and Monitoring**
```env
# Prometheus Metrics
PROMETHEUS_ENABLED=true                        # Enable Prometheus metrics
PROMETHEUS_PREFIX=<your_bot_name>                     # Metric prefix
PROMETHEUS_BUCKETS=0.1,0.5,1,2,5,10          # Histogram buckets

# Health Checks
HEALTH_CHECK_TIMEOUT=5000                      # Health check timeout (ms)
HEALTH_CHECK_INTERVAL=30000                    # Health check interval (ms)
HEALTH_CHECK_UNHEALTHY_THRESHOLD=3             # Failures before unhealthy

# Performance Monitoring
PERFORMANCE_MONITORING=true                    # Enable performance tracking
PERFORMANCE_SAMPLING_RATE=0.1                 # Sample rate (10%)
MEMORY_USAGE_WARNING_THRESHOLD=1024           # Memory warning threshold (MB)
```

---

## 📁 **Configuration Files**

### **Lavalink Configuration** (`lavalink/application.yml`)

#### **Server Configuration**
```yaml
server:
  port: <lavalink_port>  # Lavalink server port
  address: <bind_address>
  http2:
    enabled: false

spring:
  main:
    banner-mode: log
  datasource:
    hikari:
      maximumPoolSize: 20

logging:
  file:
    name: ./logs/lavalink.log
  level:
    root: INFO
    lavalink: INFO
    com.github.topi314.lavasrc: DEBUG
```

#### **Lavalink Core Settings**
```yaml
lavalink:
  plugins:
    - dependency: "dev.lavalink.youtube:youtube-plugin:1.13.5"
    - dependency: "com.github.topi314.lavasrc:lavasrc-plugin:4.8.1"
    - dependency: "com.github.topi314.lavasponsorblock:lavasponsorblock-plugin:2.0.1"
    - dependency: "com.github.topi314.lavasearch:lavasearch-plugin:1.0.0"

  server:
    password: "<lavalink_password>"
    sources:
      youtube: true
      bandcamp: true
      soundcloud: true
      twitch: true
      vimeo: true
      http: true
      local: false

    filters:
      volume: true
      equalizer: true
      karaoke: true
      timescale: true
      tremolo: true
      vibrato: true
      distortion: true
      rotation: true
      channelMix: true
      lowPass: true

    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    opusEncodingQuality: 10
    resamplingQuality: HIGH
    trackStuckThresholdMs: 10000
    useSeekGhosting: true
    youtubePlaylistLoadLimit: 6
    playerUpdateInterval: 5
    youtubeSearchEnabled: true
    soundcloudSearchEnabled: true
    gc-warnings: true

  # IP rotation for Youtube requests
  httpConfig:
    proxyHost: ""
    proxyPort: 0
    proxyUser: ""
    proxyPassword: ""
```

#### **Plugin Configurations**
```yaml
plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - MUSIC
      - ANDROID_VR
      - WEB
      - WEB_EMBEDDED
    oauth:
      enabled: false

  lavasrc:
    providers:
      - "ytsearch:\"%ISRC%\""      # ISRC search
      - "ytsearch:%QUERY%"         # YouTube search
      - "scsearch:%QUERY%"         # SoundCloud search
    sources:
      spotify: true
      applemusic: false
      deezer: false
      yandexmusic: false
      flowerytts: false
      youtube: true
    spotify:
      clientId: "<spotify_client_id>"
      clientSecret: "<spotify_client_secret>"
      countryCode: "US"
      playlistLoadLimit: 6
      albumLoadLimit: 6

  lavasponsorblock:
    enabled: true
    categories:
      - sponsor          # Sponsor segments
      - selfpromo        # Self-promotion
      - interaction      # Interaction reminders
      - intro            # Intro sequences
      - outro            # Outro sequences
      - preview          # Preview/recap
      - music_offtopic   # Non-music sections
      - filler           # Filler tangent

  lavasearch:
    enabled: true
    sources:
      - youtube
      - soundcloud
      - spotify
```

### **Docker Configuration**

#### **Production Docker Compose** (`docker-compose.production.yml`)
```yaml
version: '3.8'

services:
  gateway:
    build:
      context: .
      dockerfile: gateway/Dockerfile
      target: production
    environment:
      NODE_ENV: production
      DISCORD_TOKEN: ${DISCORD_TOKEN}
      DISCORD_APPLICATION_ID: ${DISCORD_APPLICATION_ID}
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:<redis_port>
      LAVALINK_HOST: lavalink
      LAVALINK_PORT: <lavalink_port>
      LAVALINK_PASSWORD: ${LAVALINK_PASSWORD}
    ports:
      - "${PORT_GATEWAY:-8001}:8001"
    depends_on:
      - postgres
      - redis
      - lavalink
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://container:8001/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ${DB_NAME:-<database_name>}
      POSTGRES_USER: ${DB_USER:-<database_user>}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./packages/database/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    ports:
      - "${DB_PORT:-<db_port>}:<db_port>"
    restart: unless-stopped
    command: postgres -c shared_buffers=256MB -c max_connections=100
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-<database_user>}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT:-<redis_port>}:<redis_port>"
    volumes:
      - redis_data:/data
      - ./config/redis.conf:/usr/local/etc/redis/redis.conf:ro
    restart: unless-stopped
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
```

#### **Development Docker Compose** (`docker-compose.dev.yml`)
```yaml
version: '3.8'

services:
  gateway:
    build:
      context: .
      dockerfile: gateway/Dockerfile
      target: development
    environment:
      NODE_ENV: development
      DEBUG: "your-bot:*"
      LOG_LEVEL: debug
    volumes:
      - .:/app
      - /app/node_modules
    command: npm run dev

  postgres:
    ports:
      - "<db_port>:<db_port>"
    environment:
      POSTGRES_DB: <database_name>_dev
      POSTGRES_USER: <database_user>_dev
      POSTGRES_PASSWORD: <dev_password>

  redis:
    ports:
      - "<redis_port>:<redis_port>"
    command: redis-server --appendonly yes --save 60 1
```

### **Database Configuration**

#### **Prisma Configuration** (`packages/database/prisma/schema.prisma`)
```prisma
generator client {
  provider = "prisma-client-js"
  output   = "../generated/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Connection pooling for production
generator client {
  provider = "prisma-client-js"
  previewFeatures = ["tracing"]
}

// Database settings
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### **Package Configuration** (`package.json`)

#### **Workspace Configuration**
```json
{
  "name": "your-music-bot",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "packages/*",
    "gateway",
    "audio",
    "api",
    "worker"
  ],
  "packageManager": "pnpm@8.15.1",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=8.0.0"
  },
  "scripts": {
    "dev": "pnpm --filter gateway dev",
    "dev:all": "concurrently \"pnpm --filter gateway dev\" \"pnpm --filter audio dev\" \"pnpm --filter api dev\"",
    "build": "pnpm -r build",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint . --ext .ts,.js",
    "typecheck": "tsc --noEmit",
    "db:migrate": "pnpm --filter @your-bot/database prisma migrate deploy",
    "db:seed": "pnpm --filter @your-bot/database prisma db seed"
  }
}
```

---

## 🔧 **Service-Specific Configuration**

### **Gateway Service Configuration**

#### **Discord Client Options**
```typescript
// gateway/src/config/discord.ts
export const discordConfig = {
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  presence: {
    status: 'online' as PresenceStatusData,
    activities: [{
      name: 'music with friends',
      type: ActivityType.Listening
    }]
  },
  allowedMentions: {
    parse: ['users', 'roles'],
    repliedUser: false
  },
  rest: {
    timeout: 15000,
    retries: 3,
    version: '10'
  }
};
```

#### **Command Configuration**
```typescript
// gateway/src/config/commands.ts
export const commandConfig = {
  defaultPermissions: null,        // Available to all users
  dmPermission: false,            // Guild-only commands
  cooldown: {
    play: 5000,                   // 5 second cooldown
    skip: 2000,                   // 2 second cooldown
    queue: 10000                  // 10 second cooldown
  },
  validation: {
    maxQueryLength: 500,          // Max search query length
    maxQueueSize: 100,            // Max queue size per guild
    maxVolumeLevel: 200           // Max volume (200%)
  }
};
```

### **Audio Service Configuration**

#### **Lavalink Manager Options**
```typescript
// audio/src/config/lavalink.ts
export const lavalinkConfig = {
  nodes: [{
    host: process.env.LAVALINK_HOST || '<lavalink_host>',
    port: parseInt(process.env.LAVALINK_PORT || '<lavalink_port>'),
    password: process.env.LAVALINK_PASSWORD || '<lavalink_password>',
    secure: process.env.LAVALINK_SECURE === 'true',
    identifier: process.env.LAVALINK_IDENTIFIER || 'your-bot-identifier'
  }],
  clientName: 'Your Music Bot',
  autoResume: true,
  resumeTimeout: 60,
  useUnresolvedData: true,
  defaultSearchPlatform: 'ytsearch',
  playerOptions: {
    maxRetries: 3,
    retryDelay: 1000,
    maxReconnectDelay: 30000,
    applyVolumeAsFilter: true,
    clientBasedPositionUpdateInterval: 50,
    defaultVolume: 50,
    onDisconnect: {
      autoReconnect: true,
      destroyPlayer: false
    },
    onEmptyQueue: {
      destroyAfterMs: 300000  // 5 minutes
    }
  }
};
```

#### **Search Configuration**
```typescript
// audio/src/config/search.ts
export const searchConfig = {
  defaultLimit: 10,               // Default search results
  maxLimit: 25,                   // Maximum search results
  cacheTime: 300,                 // Cache duration (5 minutes)
  platforms: {
    youtube: {
      enabled: true,
      priority: 1,
      clients: ['MUSIC', 'WEB', 'ANDROID_VR']
    },
    soundcloud: {
      enabled: true,
      priority: 2
    },
    spotify: {
      enabled: true,
      priority: 3,
      convertToYoutube: true
    }
  },
  filters: {
    minDuration: 5000,            // 5 seconds minimum
    maxDuration: 7200000,         // 2 hours maximum
    excludeChannels: [
      'topic',                    // Auto-generated channels
      'various artists',
      'unknown artist'
    ]
  }
};
```

### **API Service Configuration**

#### **Express Server Options**
```typescript
// api/src/config/server.ts
export const serverConfig = {
  port: parseInt(process.env.PORT_API || '8000'),
  host: process.env.HOST || '0.0.0.0',
  cors: {
    origin: process.env.CORS_ORIGINS?.split(',') || ['https://<your-domain.com>'],
    credentials: true,
    maxAge: 86400
  },
  rateLimit: {
    windowMs: 60000,              // 1 minute
    max: 100,                     // 100 requests per minute
    standardHeaders: true,
    legacyHeaders: false
  },
  compression: {
    level: 6,                     // Compression level
    threshold: 1024               // Only compress > 1KB
  },
  helmet: {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }
};
```

---

## 🔍 **Configuration Validation**

### **Environment Validation Schema**
```typescript
// packages/config/src/schema.ts
import { z } from 'zod';

export const configSchema = z.object({
  discord: z.object({
    token: z.string().min(1, 'Discord token is required'),
    applicationId: z.string().min(1, 'Application ID is required'),
    guildId: z.string().optional()
  }),

  lavalink: z.object({
    host: z.string().default('<lavalink_host>'),
    port: z.number().int().min(1).max(65535).default(<lavalink_port>),
    password: z.string().default('<lavalink_password>'),
    secure: z.boolean().default(false)
  }),

  database: z.object({
    url: z.string().url('Invalid database URL'),
    poolSize: z.number().int().min(1).max(50).default(10),
    timeout: z.number().int().min(1000).default(20000)
  }),

  redis: z.object({
    url: z.string().url('Invalid Redis URL').default('redis://<hostname>:<redis_port>'),
    db: z.number().int().min(0).max(15).default(0)
  }),

  app: z.object({
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    port: z.number().int().min(1000).max(65535).default(8001)
  })
});

export type Config = z.infer<typeof configSchema>;
```

### **Configuration Loading and Validation**
```typescript
// packages/config/src/index.ts
import { configSchema } from './schema';

function loadConfig(): Config {
  const rawConfig = {
    discord: {
      token: process.env.DISCORD_TOKEN,
      applicationId: process.env.DISCORD_APPLICATION_ID,
      guildId: process.env.DISCORD_GUILD_ID
    },
    lavalink: {
      host: process.env.LAVALINK_HOST,
      port: parseInt(process.env.LAVALINK_PORT || '<lavalink_port>'),
      password: process.env.LAVALINK_PASSWORD,
      secure: process.env.LAVALINK_SECURE === 'true'
    },
    database: {
      url: process.env.DATABASE_URL,
      poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '10'),
      timeout: parseInt(process.env.DATABASE_TIMEOUT || '20000')
    },
    redis: {
      url: process.env.REDIS_URL,
      db: parseInt(process.env.REDIS_DB || '0')
    },
    app: {
      nodeEnv: process.env.NODE_ENV,
      logLevel: process.env.LOG_LEVEL,
      port: parseInt(process.env.PORT || '8001')
    }
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    console.error('Configuration validation failed:', error);
    process.exit(1);
  }
}

export const config = loadConfig();
```

---

## 📊 **Performance Tuning**

### **Node.js Optimization**
```env
# Memory Management
NODE_OPTIONS=--max-old-space-size=2048          # 2GB heap limit
NODE_OPTIONS=--gc-interval=100                  # Garbage collection interval

# Performance Flags
NODE_OPTIONS=--enable-source-maps               # Enable source maps
NODE_OPTIONS=--experimental-modules             # ES modules support
NODE_OPTIONS=--no-warnings                      # Disable warnings
```

### **Database Performance**
```env
# PostgreSQL Tuning
DATABASE_SHARED_BUFFERS=256MB                   # Shared buffer size
DATABASE_EFFECTIVE_CACHE_SIZE=1GB               # Available cache
DATABASE_MAINTENANCE_WORK_MEM=64MB              # Maintenance memory
DATABASE_CHECKPOINT_COMPLETION_TARGET=0.9       # Checkpoint target
DATABASE_WAL_BUFFERS=16MB                       # WAL buffer size
DATABASE_MAX_CONNECTIONS=100                    # Max connections
```

### **Redis Performance**
```env
# Redis Optimization
REDIS_MAXMEMORY=512MB                           # Max memory usage
REDIS_MAXMEMORY_POLICY=allkeys-lru              # Eviction policy
REDIS_SAVE_INTERVAL=900 1                       # Save interval
REDIS_TCP_KEEPALIVE=<tcp_keepalive>                         # TCP keepalive
```

---

## 🔒 **Security Configuration**

### **Environment Security**
```env
# Security Headers
SECURITY_FRAME_ANCESTORS=none                   # X-Frame-Options
SECURITY_CONTENT_TYPE_OPTIONS=nosniff           # X-Content-Type-Options
SECURITY_XSS_PROTECTION=1; mode=block           # X-XSS-Protection

# Rate Limiting
SECURITY_RATE_LIMIT_ENABLED=true                # Enable rate limiting
SECURITY_RATE_LIMIT_WINDOW=900000               # 15 minute window
SECURITY_RATE_LIMIT_MAX=100                     # Max requests per window

# Input Validation
SECURITY_MAX_REQUEST_SIZE=10MB                  # Max request body size
SECURITY_MAX_PARAMETER_LENGTH=1000              # Max parameter length
SECURITY_SANITIZE_HTML=true                     # Sanitize HTML input
```

### **Secrets Management**
```env
# External Secrets (use in production)
SECRET_MANAGER_ENABLED=false                    # Enable external secrets
SECRET_MANAGER_PROVIDER=aws                     # aws, azure, gcp, vault
SECRET_MANAGER_REGION=us-east-1                 # Provider region
SECRET_MANAGER_KEY_PREFIX=your-bot/             # Secret key prefix
```

---

This comprehensive configuration reference covers all aspects of configuring the Discord music bot for different environments and use cases. Use the appropriate settings based on your deployment scenario and performance requirements.