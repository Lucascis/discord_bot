# Discord Bot Metrics Documentation

This document describes the Prometheus metrics exposed by the Discord music bot for monitoring and observability.

## Health Endpoints

- **Gateway**: `http://localhost:3001/health` & `http://localhost:3001/metrics`
- **Audio**: `http://localhost:3002/health` & `http://localhost:3002/metrics`
- **API**: `http://localhost:3000/health` & `http://localhost:3000/metrics`
- **Worker**: `http://localhost:3003/health` & `http://localhost:3003/metrics`

## Discord API Error Metrics

### `discord_api_errors_total`
**Type**: Counter
**Description**: Total number of Discord API errors encountered
**Labels**:
- `operation`: The operation being performed (e.g., `fetch_message_guild123`, `edit_message_guild456`)
- `error_code`: Discord API error code (e.g., `10008`, `50001`, `20028`)
- `retryable`: Whether the error can be retried (`true`/`false`)

**Example**:
```
discord_api_errors_total{operation="edit_message_375086837103984650",error_code="10008",retryable="false"} 3
discord_api_errors_total{operation="send_message_guild123",error_code="20028",retryable="true"} 1
```

### `discord_operation_retries_total`
**Type**: Counter
**Description**: Total number of Discord operation retry attempts
**Labels**:
- `operation`: The operation being retried
- `attempt`: Retry attempt number (2, 3, etc.)

**Example**:
```
discord_operation_retries_total{operation="edit_message_375086837103984650",attempt="2"} 1
discord_operation_retries_total{operation="fetch_message_guild123",attempt="3"} 2
```

### `discord_operation_duration_seconds_total`
**Type**: Counter
**Description**: Total duration of Discord operations in seconds
**Labels**:
- `operation`: The operation performed
- `success`: Whether the operation succeeded (`true`/`false`)

**Example**:
```
discord_operation_duration_seconds_total{operation="edit_message_guild123",success="true"} 2.45
discord_operation_duration_seconds_total{operation="send_message_guild456",success="false"} 5.12
discord_operation_duration_seconds_total{operation="edit_message_guild789_fallback",success="true"} 1.23
```

## Business Metrics

### User Engagement
- `user_command_executions_total`: Commands executed by users
- `user_session_duration_seconds`: Time users spend interacting with the bot
- `user_unique_guilds_total`: Number of unique guilds per user

### Playback Metrics
- `track_play_duration_seconds`: Total time tracks are played
- `track_skip_rate`: Ratio of skipped vs completed tracks
- `queue_length_histogram`: Distribution of queue lengths

### Search Behavior
- `search_query_types_total`: Distribution of search types (URL vs text)
- `search_results_count_histogram`: Distribution of search result counts
- `search_cache_hit_rate`: Cache hit ratio for search results

### Autoplay Performance
- `autoplay_seed_success_rate`: Success rate of autoplay seeding
- `autoplay_recommendation_types_total`: Distribution of recommendation types

## Cache Metrics

### Multi-Layer Cache Performance
- `cache_operations_total`: Total cache operations by layer (L1/L2) and type
- `cache_hit_rate`: Hit rate by cache layer and key type
- `cache_eviction_rate`: Eviction rate by reason (TTL/size)
- `cache_memory_usage_bytes`: Memory usage by cache layer

## Error Rate Analysis

### Acceptable Error Rates
- **Discord API 10008 (Unknown Message)**: < 5% of message operations
- **Discord API 20028 (Rate Limited)**: < 1% of operations
- **Cache misses**: < 30% for hot data, < 70% overall

### Alerting Thresholds
- **High error rate**: > 10% Discord API errors in 5-minute window
- **Service degradation**: > 50% failed operations in 1-minute window
- **Recovery time**: Fallback operations should complete within 2 seconds

## Common Error Patterns

### Non-Retryable Errors (Immediate Fallback)
- `10003`: Unknown Channel - Create new channel reference
- `10008`: Unknown Message - Send new message instead of edit
- `10013`: Unknown User - Skip user-specific operations
- `50001`: Missing Access - Log permission issue
- `50013`: Missing Permissions - Request permission elevation

### Retryable Errors (Exponential Backoff)
- `20028`: Rate Limited - Wait 2-8 seconds before retry
- `130000`: API Overloaded - Wait 0.5-2 seconds before retry

## Monitoring Queries

### PromQL Examples

**Discord API Error Rate**:
```promql
rate(discord_api_errors_total[5m])
```

**Operation Success Rate**:
```promql
rate(discord_operation_duration_seconds_total{success="true"}[5m]) /
rate(discord_operation_duration_seconds_total[5m])
```

**Average Operation Duration**:
```promql
rate(discord_operation_duration_seconds_total[5m]) /
rate(discord_operation_retries_total[5m])
```

**Fallback Usage Rate**:
```promql
rate(discord_operation_duration_seconds_total{operation=~".*_fallback"}[5m])
```

## Dashboard Recommendations

### Key Panels
1. **Error Rate Timeline**: Discord API errors over time by code
2. **Operation Success Rate**: Success percentage by operation type
3. **Retry Distribution**: Number of retries per operation
4. **Fallback Usage**: When and how often fallbacks are triggered
5. **Response Time**: P50, P95, P99 operation durations

### Alerts
1. **High Error Rate**: > 5% error rate for 2+ minutes
2. **Fallback Spike**: > 10 fallbacks per minute
3. **Slow Operations**: P95 > 5 seconds for 1+ minute
4. **Service Down**: No successful operations for 30+ seconds

This metrics system provides comprehensive observability for Discord API resilience and helps identify when the error handling mechanisms are successfully maintaining service availability.