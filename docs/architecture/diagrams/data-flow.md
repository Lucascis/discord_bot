# Data Flow Architecture

## Overview
This diagram illustrates the complete data flow from user interaction to audio playback, including all intermediate processing steps, service communication, and UI updates.

## Complete User Command Flow

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Gateway
    participant Redis
    participant Audio
    participant Lavalink
    participant Database
    participant YouTube

    Note over User,YouTube: /playCommand Flow

    User->>Discord: /play song name
    Discord->>Gateway: Interaction Event

    Note over Gateway: Command Handler

    Gateway->>Gateway: Validate command
    Gateway->>Discord: Reply "🎵 Processing..."<br/>(Ephemeral, prevents timeout)

    Gateway->>Database: Check ServerConfiguration<br/>(Premium features, settings)
    Database-->>Gateway: Config data

    Gateway->>Database: Check RateLimit
    Database-->>Gateway: Rate limit OK

    Gateway->>Redis: Publish to discord-bot:commands
    Note over Redis: {<br/>type: 'play',<br/>guildId, userId,<br/>query: 'song name',<br/>commandType: 'play'<br/>}

    Gateway-->>Discord: Processing message sent

    Note over Audio: Command Processor

    Redis-->>Audio: Subscribe discord-bot:commands
    Audio->>Audio: Process play command
    Audio->>Database: Get/Create Queue
    Database-->>Audio: Queue ID

    Note over Audio,Lavalink: Search & Resolution

    Audio->>Lavalink: Search track<br/>(YouTube, Spotify, etc.)
    Lavalink->>YouTube: Search API
    YouTube-->>Lavalink: Search results
    Lavalink-->>Audio: Track info

    Audio->>Database: Check LyricsCache<br/>(if enabled)
    Database-->>Audio: Cached lyrics or null

    Note over Audio: Queue Management

    alt No music playing
        Audio->>Lavalink: Connect to voice channel
        Audio->>Lavalink: Play track
        Audio->>Database: Create QueueItem
        Database-->>Audio: QueueItem created
        Audio->>Redis: Publish to discord-bot:ui:now
        Note over Redis: {<br/>action: 'create',<br/>embed: now playing,<br/>components: buttons<br/>}
    else Music already playing
        Audio->>Database: Add to queue
        Database-->>Audio: QueueItem created
        Audio->>Redis: Publish to discord-bot:ui:now
        Note over Redis: {<br/>action: 'update',<br/>queuePosition: N<br/>}
    end

    Note over Gateway: UI Manager

    Redis-->>Gateway: Subscribe discord-bot:ui:now
    Gateway->>Gateway: Delete "Processing..." message

    alt Create new UI
        Gateway->>Discord: Create channel message<br/>(Embed + Buttons)
        Discord-->>Gateway: Message ID
        Gateway->>Gateway: Cache message ID (24h TTL)
    else Update existing UI
        Gateway->>Discord: Edit existing message
        Discord-->>Gateway: Updated
    end

    Note over Audio,Lavalink: Playback Start

    Lavalink->>Audio: TrackStartEvent
    Audio->>Database: Create PlaybackHistory
    Database-->>Audio: History created
    Audio->>Redis: Publish to discord-bot:to-discord
    Note over Redis: {<br/>event: 'trackStart',<br/>track info<br/>}

    Redis-->>Gateway: Subscribe discord-bot:to-discord
    Gateway->>Discord: Update UI with playing status

    Discord-->>User: Now Playing UI<br/>(Embed + Control Buttons)
```

## Voice Connection Establishment

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Gateway
    participant Redis
    participant Audio
    participant Lavalink

    Note over User,Lavalink: Critical Voice Connection Fix (Sept 24, 2025)

    User->>Discord: Join voice channel
    Discord->>Gateway: VOICE_STATE_UPDATE (raw)

    User->>Discord: Bot triggered to join
    Discord->>Gateway: VOICE_SERVER_UPDATE (raw)

    Note over Gateway: Raw Event Handler

    Gateway->>Redis: Publish to discord-bot:to-audio
    Note over Redis: {<br/>event: 'VOICE_STATE_UPDATE',<br/>data: {...}<br/>}

    Gateway->>Redis: Publish to discord-bot:to-audio
    Note over Redis: {<br/>event: 'VOICE_SERVER_UPDATE',<br/>token, endpoint, guildId<br/>}

    Note over Audio: Voice Connection Handler

    Redis-->>Audio: Subscribe discord-bot:to-audio
    Audio->>Audio: Process VOICE_STATE_UPDATE
    Audio->>Audio: Process VOICE_SERVER_UPDATE

    Audio->>Lavalink: Send voice update
    Note over Lavalink: {<br/>sessionId,<br/>event: {token, endpoint}<br/>}

    Lavalink->>Lavalink: Establish voice connection
    Lavalink-->>Audio: player.connected = true

    Note over Audio: Voice connection ready!<br/>Resolves race condition

    Audio->>Lavalink: Play queued track
    Lavalink->>Discord: Audio stream via voice UDP

    Discord-->>User: Audio playback starts
```

## Button Interaction Flow

```mermaid
sequenceDiagram
    participant User
    participant Discord
    participant Gateway
    participant Redis
    participant Audio
    participant Lavalink

    User->>Discord: Click pause button
    Discord->>Gateway: Button Interaction

    Note over Gateway: Interaction Handler

    Gateway->>Gateway: Defer interaction<br/>(acknowledge immediately)
    Gateway->>Database: Validate permissions
    Database-->>Gateway: Permission OK

    Gateway->>Redis: Publish to discord-bot:commands
    Note over Redis: {<br/>type: 'pause',<br/>guildId, userId<br/>}

    Gateway->>Discord: Update button<br/>(disabled state)

    Note over Audio: Command Processor

    Redis-->>Audio: Subscribe discord-bot:commands
    Audio->>Lavalink: Pause player
    Lavalink-->>Audio: Player paused

    Audio->>Redis: Publish to discord-bot:ui:now
    Note over Redis: {<br/>action: 'update',<br/>status: 'paused',<br/>buttons: updated<br/>}

    Note over Gateway: UI Manager

    Redis-->>Gateway: Subscribe discord-bot:ui:now
    Gateway->>Discord: Edit message<br/>(Show play button)

    Discord-->>User: Updated UI<br/>(⏸️ → ▶️)
```

## Autoplay Flow

```mermaid
sequenceDiagram
    participant Lavalink
    participant Audio
    participant YouTube
    participant Database
    participant Redis
    participant Gateway
    participant Discord

    Note over Lavalink,Discord: Queue Empty, Autoplay Enabled

    Lavalink->>Audio: QueueEndEvent
    Audio->>Database: Get ServerConfiguration
    Database-->>Audio: autoplayEnabled: true<br/>autoplayMode: 'similar'

    Audio->>Audio: Get last played track
    Audio->>Database: Query PlaybackHistory
    Database-->>Audio: Last track info

    Note over Audio: Recommendation Engine

    alt Mode: Similar
        Audio->>YouTube: Get related tracks
        YouTube-->>Audio: Related videos
    else Mode: Artist
        Audio->>YouTube: Search by artist
        YouTube-->>Audio: Artist tracks
    else Mode: Genre
        Audio->>Audio: Detect genre from title
        Audio->>YouTube: Search genre tracks
        YouTube-->>Audio: Genre-matched tracks
    else Mode: Mixed
        Audio->>Audio: 40% artist<br/>40% genre<br/>20% similar
        Audio->>YouTube: Multiple searches
        YouTube-->>Audio: Mixed results
    end

    Audio->>Audio: Apply quality filters<br/>(Blacklist check)
    Audio->>Audio: Remove duplicates
    Audio->>Audio: Select top track

    Audio->>Database: Create QueueItem<br/>(isAutoplay: true)
    Database-->>Audio: QueueItem created

    Audio->>Lavalink: Play track
    Lavalink-->>Audio: TrackStartEvent

    Audio->>Redis: Publish to discord-bot:ui:now
    Note over Redis: {<br/>action: 'update',<br/>autoplay: true,<br/>track info<br/>}

    Redis-->>Gateway: Subscribe discord-bot:ui:now
    Gateway->>Discord: Update UI<br/>(Show autoplay indicator)

    Discord-->>Discord: Continue playback seamlessly
```

## Search and Cache Flow

```mermaid
sequenceDiagram
    participant User
    participant Gateway
    participant Redis
    participant Audio
    participant Cache
    participant Lavalink
    participant YouTube

    User->>Gateway: Search query "lofi hip hop"

    Note over Audio: Search Service

    Audio->>Cache: Check Redis cache<br/>Key: search:lofi hip hop

    alt Cache hit (5 min TTL)
        Cache-->>Audio: Cached results
        Audio->>Audio: Skip external search
    else Cache miss
        Audio->>Audio: Check rate limit<br/>(Search throttling)

        alt Rate limit OK
            Audio->>Lavalink: Search request
            Lavalink->>YouTube: YouTube API
            Lavalink->>Lavalink: LavaSearch plugin
            YouTube-->>Lavalink: Search results
            Lavalink-->>Audio: Formatted results

            Audio->>Cache: Store results<br/>TTL: 5 minutes
            Cache-->>Audio: Cached
        else Rate limited
            Audio->>Audio: Return error<br/>"Too many searches"
        end
    end

    Audio->>Gateway: Search results
    Gateway->>User: Display results
```

## Error Propagation Flow

```mermaid
sequenceDiagram
    participant Lavalink
    participant Audio
    participant Database
    participant Redis
    participant Gateway
    participant Discord
    participant User

    Note over Lavalink,User: Track Load Failure

    Lavalink->>Audio: TrackExceptionEvent<br/>(Track unavailable)

    Note over Audio: Error Classification

    Audio->>Audio: classifyYouTubeError()
    Note over Audio: {<br/>type: 'UNAVAILABLE',<br/>retryable: false,<br/>severity: 'info'<br/>}

    Audio->>Database: Log PlaybackHistory<br/>skipReason: 'error'
    Database-->>Audio: Logged

    alt Error retryable
        Audio->>Audio: Retry with backoff
        Audio->>Lavalink: Retry play
    else Error non-retryable
        Audio->>Audio: Skip to next track
        Audio->>Database: Get next QueueItem
        Database-->>Audio: Next track

        alt Queue has next track
            Audio->>Lavalink: Play next
        else Queue empty + Autoplay enabled
            Audio->>Audio: Trigger autoplay
        else Queue empty + Autoplay disabled
            Audio->>Lavalink: Disconnect
        end
    end

    Note over Audio: Notify user

    Audio->>Redis: Publish to discord-bot:ui:now
    Note over Redis: {<br/>action: 'error',<br/>message: 'Track unavailable',<br/>skipped: true<br/>}

    Redis-->>Gateway: Subscribe discord-bot:ui:now
    Gateway->>Discord: Send ephemeral message
    Discord-->>User: "⚠️ Track unavailable, skipped"

    Note over Gateway: Continue playback
    Gateway->>Discord: Update UI with current track
```

## Metrics Collection Flow

```mermaid
graph LR
    A[User Interaction] --> B[Gateway]
    B --> C[Audio]
    C --> D[Lavalink]

    B --> E[Prometheus Metrics]
    C --> E

    E --> F[discord_api_errors_total]
    E --> G[discord_operation_retries_total]
    E --> H[discord_operation_duration_seconds]
    E --> I[track_plays_total]
    E --> J[queue_size]
    E --> K[autoplay_triggers_total]

    L[Database] --> M[PlaybackHistory]
    L --> N[AuditLog]
    L --> O[EventStoreEvent]

    C --> L
    B --> L

    style E fill:#ffd43b,stroke:#f59f00
    style L fill:#845ef7,stroke:#5f3dc4,color:#fff
```

## Data Flow Patterns

### 1. Command-Response Pattern
**Flow:** User → Discord → Gateway → Redis → Audio → Lavalink → Response
**Latency:** ~200-500ms
**Use Cases:** All music commands

### 2. Event-Driven Pattern
**Flow:** Lavalink Event → Audio → Redis → Gateway → Discord UI Update
**Latency:** ~50-200ms
**Use Cases:** Track changes, player state updates

### 3. Request-Reply Pattern
**Flow:** Service → Database → Service
**Latency:** ~5-50ms
**Use Cases:** Configuration reads, queue queries

### 4. Publish-Subscribe Pattern
**Flow:** Publisher → Redis Channel → Subscriber(s)
**Latency:** ~10-100ms
**Use Cases:** All inter-service communication

## Performance Characteristics

### Throughput
- **Commands/sec:** ~50-100 per service instance
- **Database queries/sec:** ~500-1000
- **Redis pub/sub messages/sec:** ~1000-5000

### Latency Targets
- **Command acknowledgment:** <100ms (ephemeral "Processing...")
- **Track search:** <1s (with cache)
- **Playback start:** <2s (including voice connection)
- **UI updates:** <500ms

### Bottlenecks
1. **Lavalink searches** - External YouTube API calls (mitigated by caching)
2. **Voice connection establishment** - Discord voice server latency (mitigated by raw event forwarding)
3. **Database writes** - Queue updates during heavy load (mitigated by batch operations)

## Caching Strategy

### Redis Cache Layers
1. **Search results** - 5 minutes TTL
2. **UI message IDs** - 24 hours TTL
3. **Server configurations** - 1 hour TTL (invalidate on update)
4. **Rate limits** - Dynamic expiration

### Database Query Optimization
1. **Indexed queries** - Guild ID, timestamps
2. **Connection pooling** - Prisma connection pool
3. **Prepared statements** - Query plan caching
