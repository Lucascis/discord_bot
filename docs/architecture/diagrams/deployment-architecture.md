# Deployment Architecture

## Overview
This diagram illustrates the Docker-based deployment architecture with container orchestration, networking, health checks, and resource allocation.

## Container Architecture

```mermaid
graph TB
    subgraph "Docker Network: discord-network (bridge)"
        subgraph "Application Services"
            GATEWAY[Gateway Service<br/>:3001<br/>512MB RAM<br/>Health: /health]
            API[API Service<br/>:3000<br/>512MB RAM<br/>Health: /health]
            AUDIO[Audio Service<br/>:3002<br/>1GB RAM<br/>Health: /health]
            WORKER[Worker Service<br/>:3003<br/>512MB RAM<br/>Health: /health]
        end

        subgraph "Infrastructure Services"
            POSTGRES[(PostgreSQL<br/>:5432<br/>2GB RAM<br/>1GB Reserved)]
            REDIS[(Redis<br/>:6379<br/>512MB RAM<br/>256MB Reserved)]
            LAVALINK[Lavalink<br/>:2333<br/>1.5GB RAM<br/>1GB Reserved<br/>Java -Xmx1G -Xms512M)]
        end

        subgraph "Persistent Volumes"
            PG_VOL[postgres_data]
            REDIS_VOL[redis_data]
            LAVA_VOL[lavalink_logs]
            LOGS_VOL[./logs bind mount]
        end

        GATEWAY -.->|Health Check<br/>30s interval| GATEWAY
        API -.->|Health Check<br/>30s interval| API
        AUDIO -.->|Health Check<br/>30s interval| AUDIO
        WORKER -.->|Health Check<br/>30s interval| WORKER
        POSTGRES -.->|Health Check<br/>10s interval| POSTGRES
        REDIS -.->|Health Check<br/>10s interval| REDIS

        GATEWAY <-->|Redis Pub/Sub| REDIS
        API <-->|Redis Cache| REDIS
        AUDIO <-->|Redis Pub/Sub| REDIS
        WORKER <-->|BullMQ Jobs| REDIS

        GATEWAY <-->|Prisma ORM| POSTGRES
        API <-->|Prisma ORM| POSTGRES
        AUDIO <-->|Prisma ORM| POSTGRES
        WORKER <-->|Prisma ORM| POSTGRES

        AUDIO <-->|WebSocket| LAVALINK

        POSTGRES -->|Mount| PG_VOL
        REDIS -->|Mount| REDIS_VOL
        LAVALINK -->|Mount| LAVA_VOL
        GATEWAY -->|Mount| LOGS_VOL
        API -->|Mount| LOGS_VOL
        AUDIO -->|Mount| LOGS_VOL
        WORKER -->|Mount| LOGS_VOL
    end

    subgraph "External Services"
        DISCORD[Discord API<br/>Gateway & REST]
        YOUTUBE[YouTube<br/>via Lavalink Plugins]
        SPOTIFY[Spotify<br/>via LavaSrc]
    end

    GATEWAY <-->|Discord.js WebSocket| DISCORD
    LAVALINK <-->|Audio Streaming| YOUTUBE
    LAVALINK <-->|Track Resolution| SPOTIFY

    style GATEWAY fill:#4dabf7,stroke:#1971c2
    style API fill:#4dabf7,stroke:#1971c2
    style AUDIO fill:#4dabf7,stroke:#1971c2
    style WORKER fill:#4dabf7,stroke:#1971c2
    style POSTGRES fill:#845ef7,stroke:#5f3dc4,color:#fff
    style REDIS fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style LAVALINK fill:#ffd43b,stroke:#f59f00
    style PG_VOL fill:#20c997,stroke:#0ca678
    style REDIS_VOL fill:#20c997,stroke:#0ca678
    style LAVA_VOL fill:#20c997,stroke:#0ca678
    style LOGS_VOL fill:#20c997,stroke:#0ca678
    style DISCORD fill:#7950f2,stroke:#5f3dc4,color:#fff
    style YOUTUBE fill:#ff8787,stroke:#c92a2a
    style SPOTIFY fill:#51cf66,stroke:#2f9e44
```

## Service Dependencies

```mermaid
graph TD
    PG[PostgreSQL]
    REDIS[Redis]
    LAVA[Lavalink]

    PG -->|Healthy| GW[Gateway]
    REDIS -->|Healthy| GW
    LAVA -->|Started| GW

    PG -->|Healthy| API[API]
    REDIS -->|Healthy| API

    PG -->|Healthy| AUDIO[Audio]
    REDIS -->|Healthy| AUDIO
    LAVA -->|Started| AUDIO

    PG -->|Healthy| WORKER[Worker]
    REDIS -->|Healthy| WORKER

    style PG fill:#845ef7,stroke:#5f3dc4,color:#fff
    style REDIS fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style LAVA fill:#ffd43b,stroke:#f59f00
    style GW fill:#4dabf7,stroke:#1971c2
    style API fill:#4dabf7,stroke:#1971c2
    style AUDIO fill:#4dabf7,stroke:#1971c2
    style WORKER fill:#4dabf7,stroke:#1971c2
```

## Port Mapping

| Service | Internal Port | External Port | Protocol | Purpose |
|---------|--------------|---------------|----------|---------|
| Gateway | 3001 | 3001 | HTTP | Health checks, metrics |
| API | 3000 | 3000 | HTTP | REST API endpoints |
| Audio | 3002 | 3002 | HTTP | Health checks, metrics |
| Worker | 3003 | 3003 | HTTP | Health checks, metrics |
| PostgreSQL | 5432 | 5432 | TCP | Database connections |
| Redis | 6379 | 6379 | TCP | Pub/sub, caching, queues |
| Lavalink | 2333 | 2333 | HTTP/WS | Audio processing, streaming |

## Resource Allocation

### CPU Limits

```mermaid
pie title CPU Core Allocation
    "PostgreSQL" : 2
    "Lavalink" : 2
    "Audio" : 1
    "Gateway" : 1
    "API" : 1
    "Worker" : 1
    "Redis" : 0.5
```

### Memory Allocation

```mermaid
pie title Memory Distribution (GB)
    "PostgreSQL" : 2.0
    "Lavalink" : 1.5
    "Audio" : 1.0
    "Gateway" : 0.512
    "API" : 0.512
    "Worker" : 0.512
    "Redis" : 0.512
```

### Service Resource Specifications

**Gateway Service**
- Memory: 512MB limit, 256MB reserved
- CPU: Unlimited (best effort)
- Start period: 40s
- Health check interval: 30s

**API Service**
- Memory: 512MB limit, 256MB reserved
- CPU: Unlimited (best effort)
- Start period: 40s
- Health check interval: 30s

**Audio Service**
- Memory: 1GB limit, 512MB reserved
- CPU: Unlimited (best effort)
- Start period: 60s (longer due to Lavalink connection)
- Health check interval: 30s

**Worker Service**
- Memory: 512MB limit, 256MB reserved
- CPU: Unlimited (best effort)
- Start period: 40s
- Health check interval: 30s

**PostgreSQL**
- Memory: 2GB limit, 1GB reserved
- CPU: 2 cores max
- Start period: 30s
- Health check: `pg_isready -U postgres -d discord`

**Redis**
- Memory: 512MB limit, 256MB reserved
- CPU: 0.5 cores max
- Start period: 10s
- Health check: `redis-cli ping`

**Lavalink**
- Memory: 1.5GB limit, 1GB reserved
- CPU: 2 cores max
- JVM Options: `-Xmx1G -Xms512M -XX:+UseG1GC -XX:MaxGCPauseMillis=200`
- No health check (depends on service_started condition)

## Health Check Configuration

```mermaid
sequenceDiagram
    participant Docker
    participant Container
    participant HealthEndpoint

    Note over Docker: Start Period (30-60s)
    Docker->>Container: Wait for start period

    loop Every 30s for services / 10s for infrastructure
        Docker->>Container: Execute health check
        Container->>HealthEndpoint: HTTP GET /health
        HealthEndpoint-->>Container: 200 OK
        Container-->>Docker: Healthy

        alt Max 3 retries, 10s timeout
            HealthEndpoint-->>Container: Timeout/Error
            Container-->>Docker: Unhealthy (retry)
        end
    end

    Note over Docker: After 3 failed retries
    Docker->>Container: Restart container
```

### Health Check Commands

**Application Services:**
```bash
wget --no-verbose --tries=1 --spider http://localhost:{port}/health || exit 1
```

**PostgreSQL:**
```bash
pg_isready -U postgres -d discord
```

**Redis:**
```bash
redis-cli ping
```

## Volume Management

### Named Volumes (Persistent)

**postgres_data**
- Driver: local
- Purpose: Database persistence
- Backup: Critical - contains all application data

**redis_data**
- Driver: local
- Purpose: Cache and queue persistence
- Backup: Important - contains pub/sub state and job queues

**lavalink_logs**
- Driver: local
- Purpose: Lavalink debug logs
- Backup: Optional - for troubleshooting

### Bind Mounts

**./logs**
- All application services write logs here
- Accessible on host for debugging
- JSON format with rotation (10MB max, 3 files)

**./lavalink/application.yml**
- Lavalink configuration
- Read-only mount
- Updates require container restart

**./lavalink/plugins**
- Lavalink plugin JARs
- Read-write for auto-updates
- Contains YouTube, LavaSrc, SponsorBlock, LavaSearch plugins

## Network Configuration

**Network Name:** `discord-network`
**Driver:** bridge
**Isolation:** All services communicate only within this network

### Internal DNS Resolution
Services communicate using container names:
- `postgres:5432`
- `redis:6379`
- `lavalink:2333`

### Environment Variables
All services load from `.env` file:
```bash
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/discord
REDIS_URL=redis://redis:6379
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
```

## Logging Configuration

**Log Driver:** json-file
**Options:**
- `max-size: 10m` - Maximum log file size
- `max-file: 3` - Number of rotated files

Total log storage per service: ~30MB (10MB × 3 files)

## Restart Policies

All services: `unless-stopped`
- Restart on failure
- Restart on Docker daemon restart
- Don't restart if manually stopped

## Build Strategy

**Multi-stage Dockerfile:**
1. **Base stage** - Dependencies installation
2. **Build stage** - TypeScript compilation
3. **Production stage** - Minimal runtime image

**Benefits:**
- Reduced image size
- Faster deployments
- Security hardening
- Layer caching optimization

## Deployment Workflow

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant Docker as Docker Compose
    participant Infra as Infrastructure Services
    participant App as Application Services

    Dev->>Docker: docker-compose up -d
    Docker->>Infra: Start postgres, redis, lavalink

    Note over Infra: Health checks run
    Infra-->>Docker: postgres healthy
    Infra-->>Docker: redis healthy
    Infra-->>Docker: lavalink started

    Docker->>App: Start gateway, api, audio, worker
    Note over App: depends_on conditions met

    App->>Infra: Connect to postgres, redis
    App->>Infra: Audio connects to lavalink

    loop Health Checks
        Docker->>App: GET /health
        App-->>Docker: 200 OK
    end

    Note over App,Infra: All services running
```

## Scaling Considerations

### Horizontal Scaling Potential
- **Gateway:** Multiple instances with Discord sharding
- **Audio:** Multiple instances with guild-based routing
- **API:** Load balancer + multiple instances
- **Worker:** Multiple instances with job distribution

### Vertical Scaling Limits
- **PostgreSQL:** 2GB RAM, 2 CPU cores
- **Lavalink:** 1.5GB RAM, 2 CPU cores
- **Audio:** 1GB RAM (most memory-intensive service)

### Optimization Opportunities
- Redis cluster for high availability
- PostgreSQL read replicas for analytics
- Lavalink regional instances for latency reduction
