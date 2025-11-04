# Error Handling & Resilience Architecture

## Overview
This diagram illustrates the comprehensive error handling, retry logic, circuit breakers, and fallback strategies across all services. The system is designed for resilience and graceful degradation.

## Error Classification Hierarchy

```mermaid
graph TD
    ERROR[Error Detected] --> CLASSIFY{Classify Error}

    CLASSIFY --> DISCORD[Discord API Error]
    CLASSIFY --> YOUTUBE[YouTube/Lavalink Error]
    CLASSIFY --> DB[Database Error]
    CLASSIFY --> NETWORK[Network Error]
    CLASSIFY --> APP[Application Error]

    DISCORD --> D_RETRY{Retryable?}
    D_RETRY -->|Yes| D_RATE[Rate Limit 429/20028]
    D_RETRY -->|Yes| D_SERVER[Server Error 5xx]
    D_RETRY -->|No| D_PERM[Permission Error 50013]
    D_RETRY -->|No| D_NOTFOUND[Not Found 10008]
    D_RETRY -->|No| D_INVALID[Invalid Request 50035]

    YOUTUBE --> Y_CLASS{YouTube Error Type}
    Y_CLASS --> Y_UNAVAIL[Unavailable - Skip]
    Y_CLASS --> Y_REGION[Region Blocked - Skip]
    Y_CLASS --> Y_NETWORK[Network Error - Retry]
    Y_CLASS --> Y_AGE[Age Restricted - Skip]

    DB --> DB_CONN[Connection Error - Retry]
    DB --> DB_CONSTRAINT[Constraint Violation - Fail]
    DB --> DB_TIMEOUT[Timeout - Retry]

    NETWORK --> N_TIMEOUT[Timeout - Retry]
    NETWORK --> N_REFUSED[Connection Refused - Retry]
    NETWORK --> N_DNS[DNS Error - Retry]

    APP --> A_VALIDATION[Validation Error - Reject]
    APP --> A_LOGIC[Business Logic Error - Handle]

    style ERROR fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style DISCORD fill:#7950f2,stroke:#5f3dc4,color:#fff
    style YOUTUBE fill:#ff8787,stroke:#c92a2a
    style DB fill:#845ef7,stroke:#5f3dc4,color:#fff
    style NETWORK fill:#ffd43b,stroke:#f59f00
    style APP fill:#4dabf7,stroke:#1971c2
```

## Discord API Error Handling Flow

```mermaid
sequenceDiagram
    participant Service
    participant ErrorHandler
    participant Discord
    participant Metrics
    participant Logger
    participant Sentry

    Service->>ErrorHandler: Execute operation
    ErrorHandler->>Discord: API call

    alt Success
        Discord-->>ErrorHandler: 200 OK
        ErrorHandler->>Metrics: Record success
        ErrorHandler-->>Service: Result
    else Retryable Error (Rate Limit)
        Discord-->>ErrorHandler: 429 Rate Limited<br/>Retry-After: 2s
        ErrorHandler->>Logger: Log warning
        ErrorHandler->>Metrics: Increment retry counter
        ErrorHandler->>ErrorHandler: Wait 2 seconds
        ErrorHandler->>Discord: Retry API call
        Discord-->>ErrorHandler: 200 OK
        ErrorHandler->>Metrics: Record success
        ErrorHandler-->>Service: Result
    else Retryable Error (Server Error)
        Discord-->>ErrorHandler: 503 Service Unavailable
        ErrorHandler->>Logger: Log warning
        ErrorHandler->>Metrics: Increment retry counter

        loop Max 3 retries with exponential backoff
            ErrorHandler->>ErrorHandler: Wait 2^attempt seconds
            ErrorHandler->>Discord: Retry API call
            alt Success
                Discord-->>ErrorHandler: 200 OK
                ErrorHandler-->>Service: Result
            else Still failing
                Discord-->>ErrorHandler: 503
            end
        end

        ErrorHandler->>Metrics: Record failure
        ErrorHandler->>Sentry: Report error
        ErrorHandler-->>Service: Execute fallback
    else Non-Retryable Error (Unknown Message)
        Discord-->>ErrorHandler: 10008 Unknown Message
        ErrorHandler->>Logger: Log info
        ErrorHandler->>Metrics: Record non-retryable error
        ErrorHandler->>ErrorHandler: Classify fallback: 'create_new'

        ErrorHandler->>Service: Execute create_new fallback
        Service->>Discord: Create new message
        Discord-->>Service: New message created
        ErrorHandler-->>Service: Fallback result
    else Non-Retryable Error (Permission)
        Discord-->>ErrorHandler: 50013 Missing Permissions
        ErrorHandler->>Logger: Log error
        ErrorHandler->>Metrics: Record permission error
        ErrorHandler->>Sentry: Report permission issue
        ErrorHandler->>ErrorHandler: Classify fallback: 'fail_gracefully'
        ErrorHandler-->>Service: null (silent failure)
    end
```

## Discord Error Classification Matrix

```mermaid
graph LR
    subgraph "Retryable Errors"
        R1[429 - Rate Limited]
        R2[20028 - Rate Limited]
        R3[0 - Internal Error]
        R4[502 - Bad Gateway]
        R5[503 - Service Unavailable]
        R6[504 - Gateway Timeout]
    end

    subgraph "Non-Retryable with Fallback"
        N1[10008 - Unknown Message<br/>→ create_new]
        N2[10062 - Unknown Interaction<br/>→ ignore]
        N3[50083 - Message Too Old<br/>→ create_new]
        N4[50007 - Cannot DM User<br/>→ ignore]
    end

    subgraph "Non-Retryable Failures"
        F1[50013 - Missing Permissions<br/>→ fail_gracefully]
        F2[50035 - Invalid Form Body<br/>→ fail_gracefully]
        F3[10003 - Unknown Channel<br/>→ ignore]
        F4[10004 - Unknown Guild<br/>→ ignore]
    end

    R1 --> RETRY{Retry Strategy}
    RETRY --> EXP[Exponential Backoff<br/>1s, 2s, 4s, 8s, 10s max]

    N1 --> FALLBACK{Fallback Strategy}
    FALLBACK --> CREATE[Create New Message]
    FALLBACK --> DEFER[Defer Reply]
    FALLBACK --> IGNORE[Ignore & Continue]

    F1 --> FAIL{Fail Gracefully}
    FAIL --> LOG[Log Error]
    FAIL --> METRIC[Record Metric]
    FAIL --> NULL[Return null]

    style R1 fill:#51cf66,stroke:#2f9e44
    style R2 fill:#51cf66,stroke:#2f9e44
    style N1 fill:#ffd43b,stroke:#f59f00
    style F1 fill:#ff6b6b,stroke:#c92a2a,color:#fff
```

## YouTube/Lavalink Error Handling

```mermaid
sequenceDiagram
    participant Audio
    participant ErrorClassifier
    participant Lavalink
    participant Queue
    participant Autoplay
    participant Logger

    Lavalink->>Audio: TrackExceptionEvent

    Audio->>ErrorClassifier: classifyYouTubeError(error)

    ErrorClassifier->>ErrorClassifier: Extract error message
    ErrorClassifier->>ErrorClassifier: Check patterns

    alt Video Unavailable
        ErrorClassifier-->>Audio: {<br/>type: UNAVAILABLE,<br/>retryable: false,<br/>severity: 'info'<br/>}
        Audio->>Logger: Log info
        Audio->>Queue: Skip to next track
        Queue-->>Audio: Next track or null
    else Region Blocked
        ErrorClassifier-->>Audio: {<br/>type: REGION_BLOCKED,<br/>retryable: false,<br/>severity: 'info'<br/>}
        Audio->>Logger: Log info
        Audio->>Queue: Skip to next track
    else Network Error
        ErrorClassifier-->>Audio: {<br/>type: NETWORK_ERROR,<br/>retryable: true,<br/>severity: 'warning'<br/>}
        Audio->>Logger: Log warning
        Audio->>Audio: Retry with backoff
        Audio->>Lavalink: Retry play
        alt Retry succeeds
            Lavalink-->>Audio: TrackStartEvent
        else Retry fails
            Lavalink-->>Audio: TrackExceptionEvent
            Audio->>Queue: Skip to next track
        end
    else Age Restricted
        ErrorClassifier-->>Audio: {<br/>type: AGE_RESTRICTED,<br/>retryable: false,<br/>severity: 'info'<br/>}
        Audio->>Logger: Log info
        Audio->>Queue: Skip to next track
    end

    alt Queue empty after skip
        Audio->>Audio: Check autoplay enabled
        alt Autoplay enabled
            Audio->>Autoplay: Trigger autoplay
            Autoplay-->>Audio: New track
            Audio->>Lavalink: Play autoplay track
        else Autoplay disabled
            Audio->>Lavalink: Disconnect from voice
            Audio->>Audio: Send "Queue ended" message
        end
    end
```

## Circuit Breaker Pattern

```mermaid
stateDiagram-v2
    [*] --> Closed: Initial State

    Closed --> Open: Failure threshold exceeded<br/>(5 failures in 1 minute)
    Open --> HalfOpen: Timeout elapsed<br/>(30 seconds)
    HalfOpen --> Closed: Success
    HalfOpen --> Open: Failure

    Closed: Normal operation<br/>Requests pass through<br/>Failures recorded
    Open: Requests immediately fail<br/>No external calls<br/>Return cached/default
    HalfOpen: Test with single request<br/>Determine if service recovered

    note right of Closed
        Counter: 0-4 failures
        Window: 1 minute rolling
    end note

    note right of Open
        Fallback responses
        Cache utilization
        Timeout: 30s
    end note

    note right of HalfOpen
        Single test request
        Success → Reset counter
        Failure → Back to Open
    end note
```

## Circuit Breaker Implementation

```mermaid
sequenceDiagram
    participant Service
    participant CircuitBreaker
    participant External
    participant Cache

    Note over CircuitBreaker: State: Closed

    loop Normal Operation
        Service->>CircuitBreaker: Request
        CircuitBreaker->>External: Forward request
        External-->>CircuitBreaker: Success
        CircuitBreaker->>CircuitBreaker: Reset failure count
        CircuitBreaker-->>Service: Success response
    end

    Note over External: Service starts failing

    loop Failures accumulate
        Service->>CircuitBreaker: Request
        CircuitBreaker->>External: Forward request
        External-->>CircuitBreaker: Failure
        CircuitBreaker->>CircuitBreaker: Increment failure count<br/>(4/5)
        CircuitBreaker-->>Service: Failure response
    end

    Service->>CircuitBreaker: Request
    CircuitBreaker->>External: Forward request
    External-->>CircuitBreaker: Failure (5th)
    CircuitBreaker->>CircuitBreaker: Threshold exceeded!<br/>Open circuit
    CircuitBreaker-->>Service: Failure response

    Note over CircuitBreaker: State: Open

    loop Fast fail period
        Service->>CircuitBreaker: Request
        CircuitBreaker->>Cache: Get cached/fallback
        Cache-->>CircuitBreaker: Cached data
        CircuitBreaker-->>Service: Cached response<br/>(Fast fail)
    end

    Note over CircuitBreaker: 30 seconds elapsed

    CircuitBreaker->>CircuitBreaker: Transition to Half-Open

    Note over CircuitBreaker: State: Half-Open

    Service->>CircuitBreaker: Request
    CircuitBreaker->>External: Test request
    External-->>CircuitBreaker: Success
    CircuitBreaker->>CircuitBreaker: Close circuit<br/>Reset counter
    CircuitBreaker-->>Service: Success response

    Note over CircuitBreaker: State: Closed (Recovered)
```

## Fallback Strategy Decision Tree

```mermaid
graph TD
    START[Error Detected] --> TYPE{Error Type}

    TYPE --> DISCORD[Discord API Error]
    TYPE --> LAVALINK[Lavalink Error]
    TYPE --> DATABASE[Database Error]

    DISCORD --> D_CODE{Error Code}
    D_CODE -->|10008| FB1[Fallback: Create New]
    D_CODE -->|10062| FB2[Fallback: Ignore]
    D_CODE -->|50013| FB3[Fallback: Fail Gracefully]
    D_CODE -->|429| FB4[Fallback: Defer + Retry]

    LAVALINK --> L_CLASS{Classification}
    L_CLASS -->|Network| FB5[Retry with Backoff]
    L_CLASS -->|Unavailable| FB6[Skip Track]
    L_CLASS -->|Region Block| FB6
    L_CLASS -->|Age Restrict| FB6

    DATABASE --> DB_TYPE{Error Type}
    DB_TYPE -->|Connection| FB7[Retry with Backoff]
    DB_TYPE -->|Constraint| FB8[Reject Operation]
    DB_TYPE -->|Timeout| FB7

    FB1 --> ACTION1[Create new message<br/>Delete old if possible]
    FB2 --> ACTION2[Log & continue<br/>No user notification]
    FB3 --> ACTION3[Log error<br/>Send error message<br/>Return null]
    FB4 --> ACTION4[Wait retry-after<br/>Defer interaction<br/>Retry request]
    FB5 --> ACTION5[Exponential backoff<br/>Max 3 retries<br/>Then skip]
    FB6 --> ACTION6[Skip to next<br/>Check autoplay<br/>Update UI]
    FB7 --> ACTION7[Wait backoff<br/>Retry connection<br/>Max 5 retries]
    FB8 --> ACTION8[Log error<br/>Return validation error<br/>No retry]

    style FB1 fill:#51cf66,stroke:#2f9e44
    style FB2 fill:#4dabf7,stroke:#1971c2
    style FB3 fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style FB4 fill:#ffd43b,stroke:#f59f00
    style FB5 fill:#51cf66,stroke:#2f9e44
    style FB6 fill:#4dabf7,stroke:#1971c2
    style FB7 fill:#51cf66,stroke:#2f9e44
    style FB8 fill:#ff6b6b,stroke:#c92a2a,color:#fff
```

## Retry Strategy with Exponential Backoff

```mermaid
sequenceDiagram
    participant Service
    participant RetryHandler
    participant External

    Note over RetryHandler: Max retries: 3<br/>Base delay: 1s

    Service->>RetryHandler: Execute operation
    RetryHandler->>External: Attempt 1

    External-->>RetryHandler: Failure
    Note over RetryHandler: Delay: 1s (2^0)
    RetryHandler->>RetryHandler: Wait 1 second

    RetryHandler->>External: Attempt 2
    External-->>RetryHandler: Failure
    Note over RetryHandler: Delay: 2s (2^1)
    RetryHandler->>RetryHandler: Wait 2 seconds

    RetryHandler->>External: Attempt 3
    External-->>RetryHandler: Failure
    Note over RetryHandler: Delay: 4s (2^2)
    RetryHandler->>RetryHandler: Wait 4 seconds

    RetryHandler->>External: Attempt 4 (final)

    alt Final attempt succeeds
        External-->>RetryHandler: Success
        RetryHandler-->>Service: Result
    else Final attempt fails
        External-->>RetryHandler: Failure
        RetryHandler->>RetryHandler: Execute fallback
        RetryHandler-->>Service: Fallback result or error
    end

    Note over Service,External: Total time: ~7 seconds<br/>(1s + 2s + 4s)
```

## Error Metrics and Monitoring

```mermaid
graph TB
    subgraph "Error Detection"
        E1[Discord API Errors]
        E2[Lavalink Errors]
        E3[Database Errors]
        E4[Network Errors]
    end

    subgraph "Metrics Collection"
        M1[Prometheus Metrics]
        M2[discord_api_errors_total]
        M3[discord_operation_retries_total]
        M4[discord_operation_duration_seconds]
        M5[track_error_total]
        M6[circuit_breaker_state]
    end

    subgraph "Error Aggregation"
        A1[Error Rate Calculation]
        A2[Retry Success Rate]
        A3[Fallback Usage Rate]
        A4[Circuit Breaker Trips]
    end

    subgraph "Alerting"
        AL1[High Error Rate Alert<br/>>5% in 5 min]
        AL2[Circuit Open Alert<br/>Service degraded]
        AL3[Retry Exhausted Alert<br/>Fallbacks active]
    end

    subgraph "Logging & Tracing"
        L1[Structured Logs<br/>Pino + Sentry]
        L2[Error Context<br/>Guild, User, Command]
        L3[Stack Traces]
        L4[Correlation IDs]
    end

    E1 --> M1
    E2 --> M1
    E3 --> M1
    E4 --> M1

    M1 --> M2
    M1 --> M3
    M1 --> M4
    M1 --> M5
    M1 --> M6

    M2 --> A1
    M3 --> A2
    M4 --> A3
    M6 --> A4

    A1 --> AL1
    A4 --> AL2
    A2 --> AL3

    E1 --> L1
    E2 --> L1
    E3 --> L1
    E4 --> L1

    L1 --> L2
    L1 --> L3
    L1 --> L4

    style E1 fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style E2 fill:#ff8787,stroke:#c92a2a
    style M1 fill:#ffd43b,stroke:#f59f00
    style AL1 fill:#ff6b6b,stroke:#c92a2a,color:#fff
    style L1 fill:#4dabf7,stroke:#1971c2
```

## Error Recovery Strategies

### 1. Graceful Degradation
**Principle:** System continues with reduced functionality
**Examples:**
- Search fails → Use cached results
- Lyrics unavailable → Show track info only
- Premium features disabled → Fall back to free tier

### 2. Silent Recovery
**Principle:** Automatic recovery without user notification
**Examples:**
- Message edit fails → Create new message
- Voice reconnection → Automatic rejoin
- Database retry → Transparent to user

### 3. User Notification
**Principle:** Inform user of issues they need to know
**Examples:**
- Permission errors → Request admin to grant permissions
- Track unavailable → Skip and notify
- Rate limit reached → Temporary cooldown message

### 4. Fail Fast
**Principle:** Quick failure for unrecoverable errors
**Examples:**
- Invalid configuration → Startup failure
- Missing credentials → Service won't start
- Constraint violations → Immediate rejection

## Error Handling Best Practices

### Do's
- Classify errors before handling
- Use structured logging with context
- Implement retry with exponential backoff
- Provide fallback strategies
- Monitor error rates and patterns
- Test error scenarios
- Document error responses

### Don'ts
- Swallow errors silently (log everything)
- Retry indefinitely (set max attempts)
- Block user experience (use timeouts)
- Expose internal errors to users
- Retry non-retryable errors
- Ignore error metrics
- Hard-code retry delays

## Observability Integration

### Sentry Error Tracking
- Automatic error capture
- Stack trace preservation
- User context (Guild ID, User ID)
- Breadcrumbs (command history)
- Performance monitoring

### Structured Logging (Pino)
- Error severity levels
- Contextual information
- Correlation IDs
- JSON format for parsing
- Log rotation and retention

### Prometheus Metrics
- Error counters by type
- Retry attempt histograms
- Operation duration
- Circuit breaker state
- Success/failure rates
