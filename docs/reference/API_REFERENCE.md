# Discord Music Bot API Reference

**Version:** 1.0.0
**Base URL:** `http://localhost:3000/api/v1`
**Release Date:** 2025-09-20

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Request/Response Format](#requestresponse-format)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Meta](#meta)
  - [Guilds](#guilds)
  - [Music Queue](#music-queue)
  - [Search](#search)
  - [Webhooks](#webhooks)
  - [Analytics](#analytics)
- [cURL Examples](#curl-examples)
- [Postman Collection](#postman-collection)

---

## Overview

The Discord Music Bot REST API provides programmatic access to guild management, music queue operations, track search, analytics, and webhook integrations. The API follows REST principles with JSON request/response formats and uses standard HTTP status codes.

**Key Features:**
- Guild management and settings configuration
- Music queue operations (add, remove, play, pause, skip, stop)
- Multi-source track search (YouTube, Spotify, SoundCloud)
- Real-time webhook integrations
- Analytics dashboard and custom report generation
- Request tracing with unique request IDs
- Structured error responses
- Built-in rate limiting and security

---

## Authentication

All API endpoints require authentication using an API key. The API key must be provided in the request header or as a query parameter.

### Header Authentication (Recommended)

```http
X-API-Key: your-api-key-here
```

### Query Parameter Authentication

```http
GET /api/v1/guilds?apiKey=your-api-key-here
```

### Configuration

Set your API key in the `.env` file:

```bash
API_KEY=your-secure-api-key
```

**Security Notes:**
- API keys should be at least 32 characters long
- Keep your API key secret and never commit it to version control
- Rotate API keys regularly
- If `API_KEY` is not configured, endpoints will be unprotected (not recommended for production)

---

## Rate Limiting

Rate limiting is applied to all API endpoints to prevent abuse. Limits are configurable via environment variables.

### Default Rate Limits

| Subscription Tier | Window | Max Requests | Notes |
|-------------------|--------|--------------|-------|
| **FREE**          | 15 minutes | 10 requests | Standard endpoints |
| **BASIC**         | 15 minutes | 30 requests | Standard endpoints |
| **PREMIUM**       | 15 minutes | 100 requests | Standard endpoints |
| **ENTERPRISE**    | 15 minutes | Unlimited | Standard endpoints |
| **Strict Routes** | 15 minutes | 20 requests | Clamped for metrics & security |

### Configuration

```bash
# Rate limit window in milliseconds (default: 900000 = 15 minutes)
RATE_LIMIT_WINDOW_MS=900000
# Subscription tiers define standard limits (FREE 10, BASIC 30, PREMIUM 100, ENTERPRISE unlimited)

# Strict endpoints window (default: 900000 = 15 minutes)
RATE_LIMIT_STRICT_WINDOW_MS=900000

# Strict limit for sensitive endpoints (default: 20)
RATE_LIMIT_STRICT_MAX=20

# Force in-memory limiter (tests / local without Redis)
API_RATE_LIMIT_IN_MEMORY=false
```

### Rate Limit Headers

Responses include rate limit information in headers:

```http
RateLimit-Limit: 10
RateLimit-Remaining: 9
RateLimit-Reset: 1633024800
```

### Rate Limit Exceeded Response

**Status Code:** `429 Too Many Requests`

```json
{
  "error": {
    "message": "Too many requests from this IP, please try again later.",
    "code": "RATE_LIMIT_EXCEEDED",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "requestId": "req_1730376000_abc123"
  }
}
```

---

## Request/Response Format

### Standard Response Structure

All successful responses follow this structure:

```json
{
  "data": { ... },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

### Paginated Response Structure

Endpoints that return lists include pagination metadata:

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5,
    "hasNext": true,
    "hasPrevious": false
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

### Request Headers

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes | API authentication key |
| `Content-Type` | Yes (POST/PUT) | Must be `application/json` |
| `X-Request-ID` | No | Custom request ID for tracing |

---

## Error Handling

The API uses standard HTTP status codes and returns structured error responses.

### HTTP Status Codes

| Code | Status | Description |
|------|--------|-------------|
| `200` | OK | Request succeeded |
| `400` | Bad Request | Invalid request parameters or body |
| `401` | Unauthorized | Missing or invalid API key |
| `403` | Forbidden | Insufficient permissions |
| `404` | Not Found | Resource not found |
| `409` | Conflict | Resource conflict |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Server error |
| `503` | Service Unavailable | Service temporarily unavailable |

### Error Response Format

```json
{
  "error": {
    "message": "Descriptive error message",
    "code": "ERROR_CODE",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "requestId": "req_1730376000_abc123",
    "details": { ... }
  }
}
```

### Error Codes Catalog

| Code | Status | Description |
|------|--------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `CONFLICT` | 409 | Resource conflict |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_SERVER_ERROR` | 500 | Server error |

### Example Error Response

```json
{
  "error": {
    "message": "Guild not found",
    "code": "NOT_FOUND",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "requestId": "req_1730376000_abc123"
  }
}
```

---

## Endpoints

### Meta

#### Get API Version Information

Get version information and available endpoints.

```http
GET /api/v1/
```

**Authentication:** Not required
**Rate Limit:** Standard

**Response:**

```json
{
  "data": {
    "version": "1.0.0",
    "releaseDate": "2025-09-20",
    "deprecated": false,
    "endpoints": ["GET /api/v1/", "GET /api/v1/guilds", ...],
    "features": [
      "Guild management",
      "Music queue operations",
      "Search functionality",
      "Webhook integrations",
      "Analytics dashboard"
    ],
    "changelog": [
      "Initial v1 API implementation",
      "Added comprehensive input validation",
      "Implemented structured error responses"
    ]
  },
  "timestamp": "2025-10-31T12:00:00.000Z"
}
```

#### Health Check

Check API health status.

```http
GET /api/v1/health
```

**Authentication:** Not required
**Rate Limit:** Exempt

**Response:**

```json
{
  "data": {
    "status": "healthy",
    "api": "v1"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

---

### Guilds

#### List Guilds

Get a paginated list of accessible Discord guilds.

```http
GET /api/v1/guilds
```

**Authentication:** Required
**Rate Limit:** Standard

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | integer | No | 1 | Page number (min: 1) |
| `limit` | integer | No | 10 | Items per page (min: 1, max: 100) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "123456789012345678",
      "name": "My Discord Server",
      "icon": "a_d5foobar",
      "memberCount": 150,
      "available": true
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3,
    "hasNext": true,
    "hasPrevious": false
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Get Guild

Get information about a specific guild.

```http
GET /api/v1/guilds/:guildId
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild/server ID (Snowflake) |

**Response:** `200 OK`

```json
{
  "data": {
    "id": "123456789012345678",
    "name": "My Discord Server",
    "icon": "a_d5foobar",
    "memberCount": 150,
    "available": true
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

**Error Response:** `404 Not Found`

```json
{
  "error": {
    "message": "Guild not found",
    "code": "NOT_FOUND",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "requestId": "req_1730376000_abc123"
  }
}
```

#### Get Guild Settings

Get configuration settings for a guild.

```http
GET /api/v1/guilds/:guildId/settings
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Response:** `200 OK`

```json
{
  "data": {
    "guildId": "123456789012345678",
    "defaultVolume": 50,
    "autoplay": false,
    "djRoleId": "987654321098765432",
    "maxQueueSize": 100,
    "allowExplicitContent": true,
    "defaultSearchSource": "youtube",
    "announceNowPlaying": true,
    "deleteInvokeMessage": false,
    "createdAt": "2025-10-01T12:00:00.000Z",
    "updatedAt": "2025-10-31T12:00:00.000Z"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Update Guild Settings

Update configuration settings for a guild.

```http
PUT /api/v1/guilds/:guildId/settings
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "defaultVolume": 75,
  "autoplay": true,
  "djRoleId": "987654321098765432",
  "maxQueueSize": 150,
  "allowExplicitContent": false,
  "defaultSearchSource": "spotify",
  "announceNowPlaying": false,
  "deleteInvokeMessage": true
}
```

**Body Parameters:** (All optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `defaultVolume` | integer | Default volume (0-200) |
| `autoplay` | boolean | Enable autoplay when queue is empty |
| `djRoleId` | string | Discord role ID for DJ permissions |
| `maxQueueSize` | integer | Maximum queue size (1-1000) |
| `allowExplicitContent` | boolean | Allow explicit content |
| `defaultSearchSource` | string | Default search source: `youtube`, `spotify`, `soundcloud` |
| `announceNowPlaying` | boolean | Announce now playing messages |
| `deleteInvokeMessage` | boolean | Delete user command messages |

**Response:** `200 OK`

```json
{
  "data": {
    "guildId": "123456789012345678",
    "defaultVolume": 75,
    "autoplay": true,
    "djRoleId": "987654321098765432",
    "maxQueueSize": 150,
    "allowExplicitContent": false,
    "defaultSearchSource": "spotify",
    "announceNowPlaying": false,
    "deleteInvokeMessage": true,
    "createdAt": "2025-10-01T12:00:00.000Z",
    "updatedAt": "2025-10-31T12:00:00.000Z"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

---

### Music Queue

#### Get Queue

Get the current music queue for a guild.

```http
GET /api/v1/guilds/:guildId/queue
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Response:** `200 OK`

```json
{
  "data": {
    "guildId": "123456789012345678",
    "tracks": [
      {
        "title": "Never Gonna Give You Up",
        "author": "Rick Astley",
        "uri": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "identifier": "dQw4w9WgXcQ",
        "duration": 213000,
        "isSeekable": true,
        "isStream": false,
        "position": 0,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        "source": "youtube",
        "requester": {
          "id": "234567890123456789",
          "username": "JohnDoe"
        }
      }
    ],
    "currentTrack": {
      "title": "Bohemian Rhapsody",
      "author": "Queen",
      "uri": "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
      "identifier": "fJ9rUzIMcZQ",
      "duration": 354000,
      "isSeekable": true,
      "isStream": false,
      "thumbnail": "https://i.ytimg.com/vi/fJ9rUzIMcZQ/maxresdefault.jpg",
      "source": "youtube"
    },
    "position": 120000,
    "duration": 567000,
    "size": 1,
    "empty": false
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Add Track to Queue

Add a track to the music queue.

```http
POST /api/v1/guilds/:guildId/queue/tracks
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "query": "Rick Astley Never Gonna Give You Up",
  "position": 0,
  "source": "youtube"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query or direct URL |
| `position` | integer | No | Queue position (0 = next, undefined = end) |
| `source` | string | No | Search source: `youtube`, `spotify`, `soundcloud` |

**Response:** `200 OK`

```json
{
  "data": {
    "track": {
      "title": "Never Gonna Give You Up",
      "author": "Rick Astley",
      "uri": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "identifier": "dQw4w9WgXcQ",
      "duration": 213000,
      "isSeekable": true,
      "isStream": false,
      "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
      "source": "youtube"
    },
    "position": 0,
    "queue": {
      "guildId": "123456789012345678",
      "tracks": [...],
      "size": 2,
      "empty": false
    }
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Remove Track from Queue

Remove a track at a specific position from the queue.

```http
DELETE /api/v1/guilds/:guildId/queue/tracks/:position
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |
| `position` | integer | Yes | Track position in queue (0-based) |

**Response:** `200 OK`

```json
{
  "data": {
    "removedTrack": {
      "title": "Never Gonna Give You Up",
      "author": "Rick Astley",
      "uri": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "duration": 213000,
      "source": "youtube"
    },
    "queue": {
      "guildId": "123456789012345678",
      "tracks": [...],
      "size": 1,
      "empty": false
    }
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

**Error Response:** `404 Not Found`

```json
{
  "error": {
    "message": "Track at position 5 not found",
    "code": "NOT_FOUND",
    "timestamp": "2025-10-31T12:00:00.000Z",
    "requestId": "req_1730376000_abc123"
  }
}
```

#### Play / Resume

Start playing music or resume playback.

```http
POST /api/v1/guilds/:guildId/queue/play
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "userId": "234567890123456789",
  "voiceChannelId": "345678901234567890"
}
```

**Body Parameters:** (All optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Discord user ID (for permissions) |
| `voiceChannelId` | string | Voice channel ID to join |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "currentTrack": {
      "title": "Bohemian Rhapsody",
      "author": "Queen",
      "duration": 354000
    },
    "message": "Playback started"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Pause

Pause current playback.

```http
POST /api/v1/guilds/:guildId/queue/pause
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "userId": "234567890123456789"
}
```

**Body Parameters:** (All optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Discord user ID (for permissions) |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "message": "Playback paused"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Skip

Skip to the next track in the queue.

```http
POST /api/v1/guilds/:guildId/queue/skip
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "userId": "234567890123456789"
}
```

**Body Parameters:** (All optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Discord user ID (for permissions) |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "skippedTrack": {
      "title": "Bohemian Rhapsody",
      "author": "Queen"
    },
    "nextTrack": {
      "title": "Never Gonna Give You Up",
      "author": "Rick Astley"
    },
    "message": "Track skipped"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Stop

Stop playback and disconnect from voice channel.

```http
POST /api/v1/guilds/:guildId/queue/stop
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "userId": "234567890123456789",
  "clearQueue": true
}
```

**Body Parameters:** (All optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Discord user ID (for permissions) |
| `clearQueue` | boolean | Clear the queue (default: false) |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "message": "Playback stopped",
    "queueCleared": true
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Set Volume

Set playback volume.

```http
PUT /api/v1/guilds/:guildId/queue/volume
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "volume": 75,
  "userId": "234567890123456789"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `volume` | integer | Yes | Volume level (0-200) |
| `userId` | string | No | Discord user ID (for permissions) |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "volume": 75,
    "message": "Volume set to 75"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Shuffle Queue

Shuffle the current queue.

```http
POST /api/v1/guilds/:guildId/queue/shuffle
```

**Authentication:** Required
**Rate Limit:** Standard

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Request Body:**

```json
{
  "userId": "234567890123456789"
}
```

**Body Parameters:** (All optional)

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Discord user ID (for permissions) |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "queue": {
      "guildId": "123456789012345678",
      "tracks": [...],
      "size": 10
    },
    "message": "Queue shuffled"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

---

### Search

#### Search Tracks

Search for tracks across multiple music sources.

```http
GET /api/v1/search
```

**Authentication:** Required
**Rate Limit:** Standard

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query |
| `source` | string | No | `youtube` | Search source: `youtube`, `spotify`, `soundcloud`, `all` |
| `page` | integer | No | 1 | Page number |
| `limit` | integer | No | 20 | Results per page (max: 50) |

**Response:** `200 OK`

```json
{
  "data": {
    "tracks": [
      {
        "title": "Never Gonna Give You Up",
        "author": "Rick Astley",
        "uri": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "identifier": "dQw4w9WgXcQ",
        "duration": 213000,
        "isSeekable": true,
        "isStream": false,
        "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
        "source": "youtube"
      }
    ],
    "playlistInfo": null,
    "source": "youtube",
    "query": "rick astley",
    "totalResults": 150
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

**Example Request:**

```bash
curl -X GET "http://localhost:3000/api/v1/search?q=rick+astley&source=youtube&limit=10" \
  -H "X-API-Key: your-api-key"
```

---

### Webhooks

#### Trigger Music Playback

Webhook to trigger music playback via external integrations.

```http
POST /api/v1/webhooks/music/play
```

**Authentication:** Required (API Key + Webhook Signature)
**Rate Limit:** Standard

**Headers:**

| Header | Required | Description |
|--------|----------|-------------|
| `X-API-Key` | Yes | API authentication key |
| `X-Webhook-Signature` | Yes | HMAC SHA256 signature |
| `X-Webhook-Timestamp` | Yes | Unix timestamp (seconds) |

**Request Body:**

```json
{
  "guildId": "123456789012345678",
  "query": "Rick Astley Never Gonna Give You Up",
  "userId": "234567890123456789"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |
| `query` | string | Yes | Track search query or URL |
| `userId` | string | No | Discord user ID |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "message": "Music play request queued successfully",
    "event": "PLAY_MUSIC",
    "guildId": "123456789012345678"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

**Webhook Signature Generation:**

```javascript
const crypto = require('crypto');

const timestamp = Math.floor(Date.now() / 1000);
const body = JSON.stringify({ guildId: "123...", query: "..." });
const webhookSecret = "your-webhook-secret";

const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(`${timestamp}.${body}`)
  .digest('hex');
```

#### Control Music Playback

Webhook to control music playback (pause, resume, skip, stop, shuffle).

```http
POST /api/v1/webhooks/music/control
```

**Authentication:** Required (API Key + Webhook Signature)
**Rate Limit:** Standard

**Headers:** (Same as above)

**Request Body:**

```json
{
  "guildId": "123456789012345678",
  "action": "pause",
  "userId": "234567890123456789"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |
| `action` | string | Yes | Action: `pause`, `resume`, `skip`, `stop`, `shuffle` |
| `userId` | string | No | Discord user ID |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "message": "Music pause request processed successfully",
    "event": "CONTROL_MUSIC",
    "guildId": "123456789012345678",
    "action": "pause"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Send Discord Notification

Webhook to send notifications to Discord channels.

```http
POST /api/v1/webhooks/notifications
```

**Authentication:** Required (API Key + Webhook Signature)
**Rate Limit:** Standard

**Request Body:**

```json
{
  "guildId": "123456789012345678",
  "channelId": "345678901234567890",
  "message": "This is a notification message",
  "type": "info"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |
| `channelId` | string | Yes | Discord channel ID |
| `message` | string | Yes | Notification message |
| `type` | string | No | Type: `info`, `warning`, `error`, `success` |

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "message": "Notification sent successfully",
    "event": "SEND_NOTIFICATION",
    "guildId": "123456789012345678"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Subscribe to Webhook Events

Subscribe to real-time events via webhooks.

```http
POST /api/v1/webhooks/events/subscribe
```

**Authentication:** Required (API Key + Webhook Signature)
**Rate Limit:** Standard

**Request Body:**

```json
{
  "guildId": "123456789012345678",
  "webhookUrl": "https://your-server.com/webhook",
  "events": ["track_start", "track_end", "queue_updated"]
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |
| `webhookUrl` | string | Yes | Your webhook endpoint URL |
| `events` | string[] | Yes | Events to subscribe to |

**Available Events:**
- `track_start` - Track playback started
- `track_end` - Track playback ended
- `queue_updated` - Queue modified
- `player_paused` - Playback paused
- `player_resumed` - Playback resumed
- `player_stopped` - Playback stopped

**Response:** `200 OK`

```json
{
  "data": {
    "success": true,
    "message": "Webhook subscription created successfully",
    "event": "WEBHOOK_SUBSCRIBED",
    "guildId": "123456789012345678",
    "webhookUrl": "https://your-server.com/webhook",
    "events": ["track_start", "track_end", "queue_updated"]
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Test Webhook Endpoint

Test webhook endpoint for validation.

```http
GET /api/v1/webhooks/events/test
```

**Authentication:** Not required
**Rate Limit:** Standard

**Response:** `200 OK`

```json
{
  "data": {
    "status": "webhook_endpoint_active",
    "timestamp": "2025-10-31T12:00:00.000Z"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

---

### Analytics

#### Get Dashboard Metrics

Get general dashboard metrics and overview.

```http
GET /api/v1/analytics/dashboard
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Response:** `200 OK`

```json
{
  "data": {
    "overview": {
      "totalGuilds": 50,
      "activeGuilds": 35,
      "totalUsers": 5000,
      "totalTracks": 15000,
      "totalPlaytime": 500000
    },
    "performance": {
      "uptime": 864000,
      "responseTime": 45,
      "errorRate": 0.5
    },
    "activity": {
      "commandsToday": 1200,
      "tracksToday": 800,
      "peakConcurrentUsers": 250
    },
    "growth": {
      "newGuildsThisWeek": 5,
      "newUsersThisWeek": 120,
      "retentionRate": 85.5
    }
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Get Guild Analytics

Get analytics for a specific guild.

```http
GET /api/v1/analytics/guilds/:guildId
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildId` | string | Yes | Discord guild ID |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `period` | string | No | `week` | Time period: `day`, `week`, `month`, `year` |
| `limit` | integer | No | 50 | Max items to return |

**Response:** `200 OK`

```json
{
  "data": {
    "guildId": "123456789012345678",
    "period": "week",
    "metrics": {
      "totalTracks": 250,
      "totalPlaytime": 50000,
      "uniqueUsers": 45,
      "commandsUsed": 300,
      "popularTracks": [
        {
          "track": {
            "title": "Never Gonna Give You Up",
            "author": "Rick Astley",
            "duration": 213000
          },
          "playCount": 25
        }
      ],
      "userActivity": [
        {
          "userId": "234567890123456789",
          "username": "JohnDoe",
          "tracksAdded": 30,
          "commandsUsed": 45
        }
      ]
    }
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Get Popular Tracks

Get popular tracks across all guilds.

```http
GET /api/v1/analytics/music/popular
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | integer | No | 1 | Page number |
| `limit` | integer | No | 10 | Items per page |
| `period` | string | No | `week` | Time period: `day`, `week`, `month`, `year` |
| `genre` | string | No | - | Filter by genre |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "track": {
        "title": "Never Gonna Give You Up",
        "author": "Rick Astley",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "duration": 213000
      },
      "playCount": 150,
      "uniqueGuilds": 25,
      "avgRating": 4.5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 500,
    "totalPages": 50,
    "hasNext": true,
    "hasPrevious": false
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Get Usage Trends

Get usage trends and growth metrics.

```http
GET /api/v1/analytics/usage/trends
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `period` | string | No | `month` | Time period: `day`, `week`, `month`, `year` |
| `metric` | string | No | `commands` | Metric type: `commands`, `tracks`, `users`, `guilds` |

**Response:** `200 OK`

```json
{
  "data": {
    "metric": "commands",
    "period": "month",
    "dataPoints": [
      {
        "timestamp": "2025-10-01T00:00:00.000Z",
        "value": 1200,
        "change": 5.2
      },
      {
        "timestamp": "2025-10-02T00:00:00.000Z",
        "value": 1350,
        "change": 12.5
      }
    ],
    "summary": {
      "total": 35000,
      "average": 1166,
      "growth": 15.3,
      "peak": {
        "value": 2500,
        "timestamp": "2025-10-15T18:00:00.000Z"
      }
    }
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Get Performance Metrics

Get performance and system metrics.

```http
GET /api/v1/analytics/performance
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `timeRange` | string | No | `24h` | Time range: `1h`, `24h`, `7d`, `30d` |

**Response:** `200 OK`

```json
{
  "data": {
    "timeRange": "24h",
    "metrics": {
      "responseTime": {
        "avg": 45,
        "p50": 40,
        "p95": 120,
        "p99": 250
      },
      "throughput": {
        "commandsPerSecond": 5.2,
        "peakCommandsPerSecond": 15.8,
        "totalCommands": 12500
      },
      "errorRate": {
        "percentage": 0.5,
        "total": 63,
        "byType": {
          "VALIDATION_ERROR": 25,
          "NOT_FOUND": 20,
          "INTERNAL_SERVER_ERROR": 18
        }
      },
      "systemHealth": {
        "memoryUsage": 512,
        "cpuUsage": 35,
        "diskUsage": 45,
        "activeConnections": 150
      },
      "serviceStatus": {
        "gateway": "healthy",
        "audio": "healthy",
        "worker": "healthy",
        "api": "healthy"
      }
    }
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Generate Custom Report

Generate a custom analytics report.

```http
POST /api/v1/analytics/reports/generate
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Request Body:**

```json
{
  "guildIds": ["123456789012345678", "987654321098765432"],
  "metrics": ["totalTracks", "totalPlaytime", "popularTracks"],
  "dateRange": {
    "start": "2025-10-01T00:00:00.000Z",
    "end": "2025-10-31T23:59:59.000Z"
  },
  "format": "json"
}
```

**Body Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guildIds` | string[] | No | Guild IDs to include (all if omitted) |
| `metrics` | string[] | Yes | Metrics to include |
| `dateRange` | object | Yes | Date range with `start` and `end` |
| `format` | string | No | Output format: `json`, `csv`, `excel` (default: `json`) |

**Response:** `200 OK`

```json
{
  "data": {
    "reportId": "report_1730376000_abc123",
    "status": "processing",
    "downloadUrl": null,
    "estimatedCompletion": "2025-10-31T12:05:00.000Z",
    "metrics": ["totalTracks", "totalPlaytime", "popularTracks"],
    "format": "json"
  },
  "timestamp": "2025-10-31T12:00:00.000Z",
  "requestId": "req_1730376000_abc123"
}
```

#### Get Report Status

Get the status of a generated report.

```http
GET /api/v1/analytics/reports/:reportId
```

**Authentication:** Required
**Rate Limit:** Strict (20 req/15min)

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reportId` | string | Yes | Report ID from generate endpoint |

**Response:** `200 OK`

```json
{
  "data": {
    "reportId": "report_1730376000_abc123",
    "status": "completed",
    "downloadUrl": "https://cdn.example.com/reports/report_1730376000_abc123.json",
    "progress": 100,
    "createdAt": "2025-10-31T12:00:00.000Z",
    "completedAt": "2025-10-31T12:03:45.000Z"
  },
  "timestamp": "2025-10-31T12:10:00.000Z",
  "requestId": "req_1730376600_def456"
}
```

**Status Values:**
- `processing` - Report is being generated
- `completed` - Report is ready for download
- `failed` - Report generation failed

---

## cURL Examples

### Basic Authentication

```bash
# Using header authentication (recommended)
curl -X GET "http://localhost:3000/api/v1/guilds" \
  -H "X-API-Key: your-api-key"

# Using query parameter authentication
curl -X GET "http://localhost:3000/api/v1/guilds?apiKey=your-api-key"
```

### Get Guilds List

```bash
curl -X GET "http://localhost:3000/api/v1/guilds?page=1&limit=10" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json"
```

### Get Guild Settings

```bash
curl -X GET "http://localhost:3000/api/v1/guilds/123456789012345678/settings" \
  -H "X-API-Key: your-api-key"
```

### Update Guild Settings

```bash
curl -X PUT "http://localhost:3000/api/v1/guilds/123456789012345678/settings" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "autoplay": true,
    "defaultVolume": 75,
    "maxQueueSize": 150
  }'
```

### Get Music Queue

```bash
curl -X GET "http://localhost:3000/api/v1/guilds/123456789012345678/queue" \
  -H "X-API-Key: your-api-key"
```

### Add Track to Queue

```bash
curl -X POST "http://localhost:3000/api/v1/guilds/123456789012345678/queue/tracks" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Rick Astley Never Gonna Give You Up",
    "source": "youtube"
  }'
```

### Remove Track from Queue

```bash
curl -X DELETE "http://localhost:3000/api/v1/guilds/123456789012345678/queue/tracks/0" \
  -H "X-API-Key: your-api-key"
```

### Play Music

```bash
curl -X POST "http://localhost:3000/api/v1/guilds/123456789012345678/queue/play" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "234567890123456789",
    "voiceChannelId": "345678901234567890"
  }'
```

### Pause Music

```bash
curl -X POST "http://localhost:3000/api/v1/guilds/123456789012345678/queue/pause" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "234567890123456789"
  }'
```

### Skip Track

```bash
curl -X POST "http://localhost:3000/api/v1/guilds/123456789012345678/queue/skip" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "234567890123456789"
  }'
```

### Stop Music

```bash
curl -X POST "http://localhost:3000/api/v1/guilds/123456789012345678/queue/stop" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "234567890123456789",
    "clearQueue": true
  }'
```

### Set Volume

```bash
curl -X PUT "http://localhost:3000/api/v1/guilds/123456789012345678/queue/volume" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "volume": 75,
    "userId": "234567890123456789"
  }'
```

### Shuffle Queue

```bash
curl -X POST "http://localhost:3000/api/v1/guilds/123456789012345678/queue/shuffle" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "234567890123456789"
  }'
```

### Search Tracks

```bash
curl -X GET "http://localhost:3000/api/v1/search?q=rick+astley&source=youtube&limit=10" \
  -H "X-API-Key: your-api-key"
```

### Trigger Music via Webhook

```bash
# Generate signature first
TIMESTAMP=$(date +%s)
BODY='{"guildId":"123456789012345678","query":"Rick Astley"}'
SECRET="your-webhook-secret"
SIGNATURE=$(echo -n "${TIMESTAMP}.${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/.* //')

# Make request
curl -X POST "http://localhost:3000/api/v1/webhooks/music/play" \
  -H "X-API-Key: your-api-key" \
  -H "X-Webhook-Signature: $SIGNATURE" \
  -H "X-Webhook-Timestamp: $TIMESTAMP" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

### Get Dashboard Metrics

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/dashboard" \
  -H "X-API-Key: your-api-key"
```

### Get Guild Analytics

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/guilds/123456789012345678?period=week&limit=50" \
  -H "X-API-Key: your-api-key"
```

### Get Popular Tracks

```bash
curl -X GET "http://localhost:3000/api/v1/analytics/music/popular?page=1&limit=20&period=week" \
  -H "X-API-Key: your-api-key"
```

### Generate Analytics Report

```bash
curl -X POST "http://localhost:3000/api/v1/analytics/reports/generate" \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "metrics": ["totalTracks", "totalPlaytime", "popularTracks"],
    "dateRange": {
      "start": "2025-10-01T00:00:00.000Z",
      "end": "2025-10-31T23:59:59.000Z"
    },
    "format": "json"
  }'
```

---

## Postman Collection

### Import Collection

Create a Postman collection with the following base configuration:

**Collection Variables:**

| Variable | Value | Description |
|----------|-------|-------------|
| `baseUrl` | `http://localhost:3000/api/v1` | API base URL |
| `apiKey` | `your-api-key` | Your API key |
| `guildId` | `123456789012345678` | Test guild ID |
| `userId` | `234567890123456789` | Test user ID |

**Pre-request Script (Collection Level):**

```javascript
// Add API key to all requests
pm.request.headers.add({
    key: 'X-API-Key',
    value: pm.collectionVariables.get('apiKey')
});

// Add request ID for tracing
pm.request.headers.add({
    key: 'X-Request-ID',
    value: `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
});
```

**Tests (Collection Level):**

```javascript
// Check status code
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

// Check response structure
pm.test("Response has data and timestamp", function () {
    const jsonData = pm.response.json();
    pm.expect(jsonData).to.have.property('data');
    pm.expect(jsonData).to.have.property('timestamp');
});

// Check response time
pm.test("Response time is less than 500ms", function () {
    pm.expect(pm.response.responseTime).to.be.below(500);
});
```

### Sample Postman Requests

#### 1. Get Guilds
```
GET {{baseUrl}}/guilds?page=1&limit=10
```

#### 2. Get Guild
```
GET {{baseUrl}}/guilds/{{guildId}}
```

#### 3. Update Guild Settings
```
PUT {{baseUrl}}/guilds/{{guildId}}/settings
Body (JSON):
{
  "autoplay": true,
  "defaultVolume": 75
}
```

#### 4. Get Queue
```
GET {{baseUrl}}/guilds/{{guildId}}/queue
```

#### 5. Add Track
```
POST {{baseUrl}}/guilds/{{guildId}}/queue/tracks
Body (JSON):
{
  "query": "Rick Astley Never Gonna Give You Up",
  "source": "youtube"
}
```

#### 6. Search Tracks
```
GET {{baseUrl}}/search?q=rick+astley&source=youtube&limit=10
```

#### 7. Get Dashboard Metrics
```
GET {{baseUrl}}/analytics/dashboard
```

### Export Collection JSON

Save this as `discord-bot-api.postman_collection.json`:

```json
{
  "info": {
    "name": "Discord Music Bot API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    { "key": "baseUrl", "value": "http://localhost:3000/api/v1" },
    { "key": "apiKey", "value": "your-api-key" },
    { "key": "guildId", "value": "123456789012345678" },
    { "key": "userId", "value": "234567890123456789" }
  ],
  "item": [
    {
      "name": "Guilds",
      "item": [
        {
          "name": "Get Guilds",
          "request": {
            "method": "GET",
            "header": [
              { "key": "X-API-Key", "value": "{{apiKey}}" }
            ],
            "url": {
              "raw": "{{baseUrl}}/guilds?page=1&limit=10",
              "host": ["{{baseUrl}}"],
              "path": ["guilds"],
              "query": [
                { "key": "page", "value": "1" },
                { "key": "limit", "value": "10" }
              ]
            }
          }
        }
      ]
    }
  ]
}
```

---

## Additional Notes

### Environment Variables Reference

Required environment variables for API service:

```bash
# API Configuration
API_KEY=your-secure-api-key
PORT=3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_STRICT_WINDOW_MS=900000
RATE_LIMIT_STRICT_MAX=20
API_RATE_LIMIT_IN_MEMORY=false

# CORS
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com

# Webhook Security
WEBHOOK_SECRET=your-webhook-secret

# Database & Redis
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/discord
REDIS_URL=redis://localhost:6379

# Node Environment
NODE_ENV=development
```

### Best Practices

1. **Always use header authentication** instead of query parameters for security
2. **Implement retry logic** with exponential backoff for rate limit errors
3. **Store API keys securely** using environment variables or secret managers
4. **Monitor rate limit headers** to avoid hitting limits
5. **Use request IDs** for debugging and tracing requests
6. **Validate webhook signatures** for all webhook endpoints
7. **Handle errors gracefully** and provide meaningful error messages to users
8. **Cache responses** where appropriate to reduce API load
9. **Use pagination** for list endpoints to avoid large responses
10. **Test in development** before deploying to production

### Support & Resources

- **Documentation:** See `docs/` directory
- **Architecture:** See `CLAUDE.md` for system architecture
- **Setup Guide:** See `docs/SETUP.md`
- **GitHub Issues:** Report bugs and request features

---

**Last Updated:** 2025-10-31
**API Version:** 1.0.0
**Documentation Version:** 1.0.0
