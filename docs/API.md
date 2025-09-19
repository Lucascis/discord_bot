# 🚀 Discord Music Bot - API Reference

## 📋 Overview

This document provides comprehensive API documentation for the Discord Music Bot's microservices architecture. The system exposes endpoints for health monitoring, metrics collection, and external integrations.

### 🏗️ **Architecture Status**

| Service | Port | Status | Implementation | API Level |
|---------|------|--------|---------------|----------|
| **Gateway** | 3001 | ✅ Functional | Legacy/MVC/Clean | Basic |
| **Audio** | 3002 | ✅ Functional | Optimized | Advanced |
| **API** | 3000 | ✅ Functional | Express | Full REST |
| **Worker** | 3003 | ⚠️ Minimal | Basic | Health only |
| **Lavalink** | 2333 | ✅ External | v4 Enterprise | Native |

### 🔍 **Quick API Health Check**
```bash
# Test all service endpoints
curl http://localhost:3001/health  # Gateway
curl http://localhost:3002/health  # Audio
curl http://localhost:3000/health  # API
curl http://localhost:3003/health  # Worker
curl http://localhost:2333/version # Lavalink
```

## 🚪 Service Endpoints

### 🆖 **Gateway Service** (Port 3001)

**Base URL**: `http://localhost:3001`
**Implementation**: Multiple (Legacy/MVC/Clean Architecture)
**Primary Function**: Discord bot interface and command handling

#### Health & Monitoring

##### `GET /health`
Comprehensive health check including Discord connection, database, and Redis connectivity.

**Response Status Codes**:
- `200` - All systems healthy
- `503` - Service degraded or unhealthy

**Response Example** (✅ Healthy):
```json
{
  "service": "gateway",
  "version": "1.0.0",
  "status": "healthy",
  "uptime": 3600,
  "timestamp": "2025-12-17T12:00:00.000Z",
  "implementation": "legacy",
  "discord": {
    "connected": true,
    "guilds": 25,
    "latency": 45
  },
  "checks": {
    "discord": {
      "status": "healthy",
      "message": "Connected to Discord API",
      "responseTime": 45
    },
    "database": {
      "status": "healthy",
      "message": "PostgreSQL connection active",
      "responseTime": 12
    },
    "redis": {
      "status": "healthy",
      "message": "Redis pub/sub operational",
      "responseTime": 8
    }
  },
  "metrics": {
    "commandsProcessed": 1450,
    "activeGuilds": 25,
    "memoryUsage": "245MB"
  }
}
```
      "message": "Connected to Discord API",
      "responseTime": 45
    },
    "database": {
      "status": "healthy", 
      "message": "Database connection active",
      "responseTime": 12
    },
    "redis": {
      "status": "healthy",
      "message": "Redis connection active", 
      "responseTime": 8
    }
  },
  "overall": {
    "status": "healthy",
    "message": "All systems operational",
    "responseTime": 65
  }
}
```

**Status Levels**:
- `healthy`: All systems operational
- `degraded`: Some non-critical systems unavailable
- `unhealthy`: Critical systems down

```http
GET /ready
```
Returns readiness status for load balancer health checks.

```http
GET /metrics
```
Returns Prometheus-format metrics for monitoring.

**Metrics Include**:
- Discord API request rates and latency
- Command processing times
- Error rates by command type
- User interaction statistics
- Guild count and activity metrics

### Audio Service (Port 3002)

**Base URL**: `http://localhost:3002`

#### Health & Monitoring

```http
GET /health
```
Comprehensive health check including Lavalink connection, database, Redis, and memory usage.

**Response Example**:
```json
{
  "service": "audio",
  "version": "1.0.0", 
  "status": "healthy",
  "uptime": 7200,
  "timestamp": "2024-01-01T14:00:00.000Z",
  "checks": {
    "lavalink": {
      "status": "healthy",
      "message": "Connected to Lavalink server",
      "responseTime": 23,
      "details": {
        "nodes": 1,
        "connectedNodes": 1,
        "players": 15
      }
    },
    "database": {
      "status": "healthy",
      "message": "Database connection active",
      "responseTime": 8
    },
    "redis": {
      "status": "healthy", 
      "message": "Redis pub/sub active",
      "responseTime": 5
    },
    "memory": {
      "status": "healthy",
      "message": "Memory usage: 512MB / 2GB",
      "responseTime": 2,
      "details": {
        "heapUsed": "512MB",
        "heapTotal": "768MB",
        "external": "45MB",
        "rss": "1.2GB",
        "usagePercent": "25%"
      }
    }
  }
}
```

#### Player Status

```http
GET /players
```
Returns current status of all active music players across guilds.

**Response Example**:
```json
{
  "players": [
    {
      "guildId": "123456789012345678",
      "connected": true,
      "playing": true,
      "paused": false,
      "queueSize": 12,
      "current": "Artist - Song Title",
      "position": 45000,
      "duration": 180000,
      "volume": 85
    }
  ],
  "count": 1,
  "totalQueueItems": 12
}
```

#### Performance Metrics

```http
GET /performance
```
Returns detailed performance metrics for the audio service.

**Response Example**:
```json
{
  "performance": {
    "search": {
      "avgTime": 234,
      "count": 1542,
      "minTime": 45,
      "maxTime": 2100
    },
    "queue_save": {
      "avgTime": 67,
      "count": 890,
      "minTime": 12,
      "maxTime": 450
    },
    "automix_check": {
      "avgTime": 23,
      "count": 456,
      "minTime": 8,
      "maxTime": 120
    }
  },
  "search": {
    "concurrent": 2,
    "waiting": 0,
    "maxConcurrent": 5
  },
  "memory": {
    "heapUsed": 512,
    "heapTotal": 768,
    "external": 45,
    "rss": 1200
  },
  "cache": {
    "search": {
      "size": 156,
      "maxSize": 2000,
      "hitRate": 0.78
    },
    "automix": {
      "size": 89,
      "maxSize": 500,
      "hitRate": 0.92
    },
    "queue": {
      "size": 23,
      "maxSize": 200,
      "hitRate": 0.65
    }
  },
  "timestamp": "2024-01-01T14:00:00.000Z"
}
```

### API Service (Port 3000)

**Base URL**: `http://localhost:3000`

#### Queue Management

```http
GET /api/v1/guilds/{guildId}/queue
```
Retrieves the current queue for a guild.

**Parameters**:
- `guildId`: Discord guild ID

**Response Example**:
```json
{
  "guildId": "123456789012345678",
  "queue": {
    "current": {
      "title": "Artist - Song Title",
      "url": "https://youtube.com/watch?v=...",
      "duration": 180000,
      "requestedBy": "987654321098765432",
      "position": 45000
    },
    "upcoming": [
      {
        "title": "Next Song",
        "url": "https://spotify.com/track/...",
        "duration": 210000,
        "requestedBy": "456789012345678901"
      }
    ],
    "totalItems": 12,
    "totalDuration": 2340000
  },
  "player": {
    "playing": true,
    "paused": false,
    "volume": 85,
    "repeatMode": "off"
  }
}
```

```http
POST /api/v1/guilds/{guildId}/queue
```
Adds a track to the guild's queue.

**Request Body**:
```json
{
  "query": "artist song title",
  "userId": "123456789012345678",
  "position": 0
}
```

```http
DELETE /api/v1/guilds/{guildId}/queue/{index}
```
Removes a track from the queue at the specified index.

#### Player Control

```http
POST /api/v1/guilds/{guildId}/player/play
```
Starts or resumes playback.

```http
POST /api/v1/guilds/{guildId}/player/pause
```  
Pauses playback.

```http
POST /api/v1/guilds/{guildId}/player/skip
```
Skips to the next track.

```http
POST /api/v1/guilds/{guildId}/player/seek
```
Seeks to a specific position in the current track.

**Request Body**:
```json
{
  "position": 60000
}
```

```http
POST /api/v1/guilds/{guildId}/player/volume
```
Sets the player volume.

**Request Body**:
```json
{
  "volume": 75
}
```

#### Guild Configuration

```http
GET /api/v1/guilds/{guildId}/config
```
Retrieves guild-specific configuration.

**Response Example**:
```json
{
  "guildId": "123456789012345678",
  "prefix": "!",
  "language": "en",
  "djRole": "DJ",
  "features": {
    "autoplay": true,
    "voteskip": false,
    "restrictions": {
      "maxQueueSize": 100,
      "maxTrackDuration": 600000
    }
  }
}
```

```http
PATCH /api/v1/guilds/{guildId}/config
```
Updates guild configuration.

**Request Body**:
```json
{
  "autoplay": false,
  "djRole": "Music Manager"
}
```

### Worker Service (Port 3003)

**Base URL**: `http://localhost:3003`

#### Background Jobs

```http
GET /jobs
```
Returns status of background job processing.

**Response Example**:
```json
{
  "jobs": {
    "queue_cleanup": {
      "status": "running",
      "lastRun": "2024-01-01T13:45:00.000Z",
      "nextRun": "2024-01-01T14:00:00.000Z",
      "processed": 145
    },
    "metrics_aggregation": {
      "status": "completed",
      "lastRun": "2024-01-01T14:00:00.000Z", 
      "nextRun": "2024-01-01T15:00:00.000Z",
      "processed": 2340
    }
  }
}
```

## WebSocket Events

### Real-time Updates

The system supports WebSocket connections for real-time updates:

**Connection**: `ws://localhost:3000/ws`

#### Events

**Player State Updates**:
```json
{
  "event": "player_update",
  "guildId": "123456789012345678",
  "data": {
    "playing": true,
    "track": {
      "title": "Current Song",
      "position": 45000,
      "duration": 180000
    }
  }
}
```

**Queue Changes**:
```json
{
  "event": "queue_update", 
  "guildId": "123456789012345678",
  "data": {
    "action": "add",
    "track": {
      "title": "New Song",
      "index": 5
    },
    "totalItems": 13
  }
}
```

## Authentication

### API Keys

For external integrations, API keys are required:

**Header**: `Authorization: Bearer your-api-key`

### Discord OAuth2

For user-specific operations, Discord OAuth2 is supported:

**Scopes**: `guilds`, `guilds.members.read`

## Rate Limiting

All endpoints are rate-limited to prevent abuse:

- **General endpoints**: 100 requests/minute per IP
- **Queue operations**: 30 requests/minute per guild
- **Player controls**: 60 requests/minute per guild

**Rate Limit Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1640995200
```

## Error Responses

All errors follow a consistent format:

```json
{
  "error": {
    "code": "INVALID_GUILD",
    "message": "Guild not found or bot not present",
    "details": {
      "guildId": "123456789012345678"
    }
  },
  "timestamp": "2024-01-01T12:00:00.000Z",
  "requestId": "req_abc123"
}
```

### Error Codes

- `INVALID_GUILD`: Guild not found or inaccessible
- `PLAYER_NOT_FOUND`: No active player for guild
- `TRACK_NOT_FOUND`: Requested track not available
- `PERMISSION_DENIED`: Insufficient permissions
- `RATE_LIMITED`: Request rate limit exceeded
- `SERVICE_UNAVAILABLE`: Backend service unavailable
- `VALIDATION_ERROR`: Invalid request parameters

## SDK Examples

### Node.js

```javascript
const axios = require('axios');

class MusicBotClient {
  constructor(baseUrl, apiKey) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async getQueue(guildId) {
    const response = await this.client.get(`/api/v1/guilds/${guildId}/queue`);
    return response.data;
  }

  async addTrack(guildId, query, userId) {
    const response = await this.client.post(`/api/v1/guilds/${guildId}/queue`, {
      query,
      userId
    });
    return response.data;
  }

  async controlPlayer(guildId, action) {
    const response = await this.client.post(`/api/v1/guilds/${guildId}/player/${action}`);
    return response.data;
  }
}

// Usage
const bot = new MusicBotClient('http://localhost:3000', 'your-api-key');
const queue = await bot.getQueue('123456789012345678');
```

### Python

```python
import requests
from typing import Dict, Any

class MusicBotClient:
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
    
    def get_queue(self, guild_id: str) -> Dict[str, Any]:
        response = requests.get(
            f'{self.base_url}/api/v1/guilds/{guild_id}/queue',
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()
    
    def add_track(self, guild_id: str, query: str, user_id: str) -> Dict[str, Any]:
        response = requests.post(
            f'{self.base_url}/api/v1/guilds/{guild_id}/queue',
            json={'query': query, 'userId': user_id},
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

# Usage
bot = MusicBotClient('http://localhost:3000', 'your-api-key')
queue = bot.get_queue('123456789012345678')
```

## Monitoring Integration

### Prometheus Metrics

All services expose Prometheus-compatible metrics at `/metrics`:

**Key Metrics**:
- `discord_commands_total`: Total Discord commands processed
- `audio_tracks_played_total`: Total tracks played
- `lavalink_events_total`: Lavalink event counts
- `database_queries_duration_seconds`: Database query performance
- `cache_hit_rate`: Cache effectiveness
- `memory_usage_bytes`: Service memory consumption

### Grafana Dashboard

Example queries for monitoring:

```promql
# Command rate per minute
rate(discord_commands_total[1m]) * 60

# Average search time
avg(audio_search_duration_seconds)

# Cache hit rate
avg(cache_hit_rate) * 100

# Active players
sum(audio_players_active)
```

---

*This API reference provides comprehensive documentation for integrating with and monitoring the Discord Music Bot system. For implementation examples and advanced usage, see the individual service directories.*