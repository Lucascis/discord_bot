# Discord Music Bot - System Architecture

## Overview

This Discord music bot is built as a sophisticated microservices architecture with enterprise-grade patterns, comprehensive testing, and production-ready operational capabilities. The system demonstrates advanced TypeScript usage, modern development practices, and thoughtful design prioritizing both functionality and maintainability.

## System Architecture

### Microservices Structure

The bot consists of 4 main services communicating via Redis pub/sub and sharing a PostgreSQL database:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Gateway       │    │     Audio       │    │      API        │
│   (Port 3001)   │    │   (Port 3002)   │    │   (Port 3000)   │
│                 │    │                 │    │                 │
│ Discord.js v14  │    │ Lavalink Client │    │   REST API      │
│ Slash Commands  │    │ Queue Manager   │    │   Web Dashboard │
│ Button Controls │    │ Music Engine    │    │   Webhooks      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                ┌─────────────────┴─────────────────┐
                │           Worker Service          │
                │           (Port 3003)             │
                │                                   │
                │        Background Jobs            │
                │       Queue Processing            │
                │      Scheduled Tasks              │
                └───────────────────────────────────┘
```

### Inter-Service Communication

- **Redis Pub/Sub**: Real-time command routing between gateway and audio services
- **Shared Database**: PostgreSQL for persistent state across all services
- **HTTP Health Checks**: Each service exposes monitoring endpoints

### External Dependencies

- **Lavalink v4**: High-performance audio streaming with multi-source support
- **PostgreSQL**: Primary data persistence with optimized schema
- **Redis**: Caching and message broker
- **Music Sources**: YouTube, Spotify, Deezer, Apple Music integration

## Service Details

### Gateway Service (`gateway/`)

**Primary Responsibility**: Discord interaction handling and command processing

**Key Features**:
- Discord.js v14 integration with slash commands
- Interactive button-based controls
- User permission management (DJ roles)
- Rate limiting and input validation
- Error handling with user feedback

**Main Components**:
- `index.ts`: Discord client setup and event handlers
- `flags.ts`: Feature flag management with caching
- `validation.ts`: Input sanitization and security

### Audio Service (`audio/`)

**Primary Responsibility**: Music playback engine and queue management

**Key Features**:
- Lavalink client integration
- Intelligent queue management with persistence
- Autoplay/automix functionality
- Performance monitoring and optimization
- Graceful error recovery

**Main Components**:
- `index.ts`: Main service with command handlers
- `performance.ts`: Caching, memory management, metrics
- `cache.ts`: Multi-level caching implementation
- `autoplay.ts`: Intelligent track recommendation

### API Service (`api/`)

**Primary Responsibility**: External API and web dashboard

**Key Features**:
- REST API for external integrations
- Web dashboard for queue management
- Webhook endpoints for external services
- Authentication and authorization

### Worker Service (`worker/`)

**Primary Responsibility**: Background job processing

**Key Features**:
- Scheduled maintenance tasks
- Queue cleanup operations
- Performance metric aggregation
- Database optimization jobs

## Shared Packages (`packages/`)

### Database Package (`@discord-bot/database`)

**Purpose**: Centralized database client with optimized schema

**Features**:
- Prisma ORM with PostgreSQL
- Optimized indexes for query performance
- Migration system for schema evolution
- Type-safe database operations

**Schema Overview**:
```typescript
// Core models
GuildConfig    // Per-guild configuration
Queue          // Music queue persistence
QueueItem      // Individual tracks
UserProfile    // User preferences
AuditLog       // Action logging
RateLimit      // Rate limiting data
FeatureFlag    // Runtime feature toggles
```

### Configuration Package (`@discord-bot/config`)

**Purpose**: Type-safe environment configuration

**Features**:
- Zod schema validation for all environment variables
- Runtime configuration verification
- Development/production environment handling
- Security-focused validation

### Logger Package (`@discord-bot/logger`)

**Purpose**: Structured logging and health monitoring

**Features**:
- Pino-based structured logging
- Health check utilities
- Performance monitoring
- OpenTelemetry integration

## Key Technical Patterns

### Caching Strategy

**Multi-Level Caching**:
1. **Memory Cache**: TTL-based in-memory cache for frequent operations
2. **Redis Cache**: Shared cache across services
3. **Database Optimization**: Selective queries with proper indexes

**Cache Implementation**:
```typescript
// Example from audio/src/cache.ts
export class MemoryCache<T> {
  // TTL-based cache with automatic cleanup
  // Hit rate tracking and statistics
  // LRU eviction when at capacity
}
```

### Error Handling

**Circuit Breaker Pattern**:
```typescript
// Comprehensive error handling with graceful degradation
export const withErrorHandling = (operation: string) =>
  async <T>(fn: () => Promise<T>): Promise<T> => {
    // Timeout handling, retry logic, fallback mechanisms
  }
```

**Features**:
- Automatic retry with exponential backoff
- Service degradation rather than complete failure
- User-friendly error messages
- Comprehensive error logging

### Health Monitoring

**Health Check System**:
```typescript
// Each service implements comprehensive health checks
healthChecker.register('database', () => CommonHealthChecks.database(prisma));
healthChecker.register('redis', () => CommonHealthChecks.redis(redisClient));
healthChecker.register('lavalink', () => CommonHealthChecks.lavalink(manager));
```

**Monitoring Levels**:
- **Healthy**: All systems operational
- **Degraded**: Some non-critical systems unavailable
- **Unhealthy**: Critical systems down

### Input Validation

**Security-First Approach**:
```typescript
// Comprehensive input sanitization
export const validateAndSanitizeInput = (input: string): ValidationResult => {
  // XSS prevention, injection attack mitigation
  // Discord markdown sanitization
  // URL validation with private network blocking
}
```

## Performance Optimizations

### Database Optimizations

**Indexes**:
- Composite indexes on frequently queried fields
- Optimized for `(guildId, createdAt)` patterns
- Unique constraints for data integrity

**Query Optimization**:
- Selective field retrieval with `select` clauses
- Batch operations for bulk updates
- Connection pooling for efficiency

### Caching Implementation

**Queue Caching**:
```typescript
// 30-second TTL for frequently changing data
async function getQueueCached(guildId: string): Promise<any | null> {
  // Cache with automatic invalidation on updates
}
```

**Feature Flag Caching**:
```typescript
// 5-minute TTL for configuration data
const flagCache = new Map<string, { value: boolean; expires: number }>();
```

### Memory Management

**Monitoring and Cleanup**:
```typescript
export class MemoryManager {
  // Automatic memory usage monitoring
  // Garbage collection triggering
  // Resource cleanup on high usage
}
```

## Testing Strategy

### Comprehensive Test Coverage

**Test Types**:
- Unit tests for individual functions
- Integration tests for service interactions
- Security tests for input validation
- Performance tests for optimization verification

**Test Structure**:
```
audio/test/           # Audio service tests
gateway/test/         # Gateway service tests  
packages/*/test/      # Shared package tests
```

**Key Testing Features**:
- Vitest for modern ES module support
- Workspace aliases for source testing
- Mocked external dependencies
- Comprehensive validation testing

## Security Considerations

### Input Validation

**Multi-Layer Protection**:
1. **Schema validation** with Zod
2. **Input sanitization** for XSS prevention
3. **Discord snowflake validation** for proper ID formats
4. **URL validation** with protocol restrictions

### Environment Security

**Configuration Security**:
- Production warning systems
- Credential validation
- Private network access prevention
- Rate limiting implementation

## Development Workflow

### Setup Requirements

```bash
# Prerequisites
Node.js 18+, pnpm, PostgreSQL, Redis, Docker

# Development setup
pnpm install
docker-compose up -d  # Start services
pnpm dev             # Start all services
```

### Build and Deployment

**Production Build**:
```bash
pnpm build          # Build all services
pnpm start          # Start production services
```

**Docker Deployment**:
```dockerfile
# Multi-stage build for optimized production images
FROM node:18-alpine AS builder
# Build stage...
FROM node:18-alpine AS production
# Production stage...
```

## Monitoring and Observability

### Metrics Collection

**Prometheus Integration**:
- Service-specific metrics
- Performance tracking
- Resource usage monitoring
- Custom business metrics

### Health Endpoints

Each service exposes:
- `GET /health` - Overall service health
- `GET /ready` - Readiness for traffic
- `GET /metrics` - Prometheus metrics
- `GET /performance` - Performance statistics

## Future Considerations

### Scalability

The architecture supports horizontal scaling through:
- Stateless service design
- External state management (PostgreSQL/Redis)
- Load balancer compatibility
- Container orchestration readiness

### Extensibility

The modular design enables:
- Additional music source integration
- New service addition
- Feature flag-based rollouts
- Plugin system development

---

*This architecture documentation provides a comprehensive overview of the Discord music bot system. For implementation details, see the individual service directories and shared package documentation.*