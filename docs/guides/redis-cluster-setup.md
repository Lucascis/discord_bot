# Redis Cluster Setup Guide

This guide shows how to use the Redis Cluster client for high availability and horizontal scaling.

## Overview

The Redis Cluster client provides:
- **Automatic failover** when master nodes fail
- **Horizontal scaling** across multiple nodes
- **Circuit breaker** for fault tolerance
- **Health monitoring** and metrics
- **Read scaling** to slave nodes

## Quick Start

### 1. Environment Configuration

Add Redis cluster nodes to your `.env`:

```env
# Redis Cluster Configuration
REDIS_CLUSTER_NODES=redis-node-1:6379,redis-node-2:6379,redis-node-3:6379

# Or individual nodes
REDIS_NODE_1_HOST=redis-node-1
REDIS_NODE_1_PORT=6379
REDIS_NODE_2_HOST=redis-node-2
REDIS_NODE_2_PORT=6379
REDIS_NODE_3_HOST=redis-node-3
REDIS_NODE_3_PORT=6379
```

### 2. Basic Usage

```typescript
import { createRedisCluster, parseClusterNodes } from '@discord-bot/cache';

// Parse nodes from environment variable
const nodes = parseClusterNodes(process.env.REDIS_CLUSTER_NODES!);

// Create cluster client
const cluster = createRedisCluster(nodes, {
  maxRetries: 3,
  retryDelay: 1000,
  healthCheckInterval: 30000,
  circuitBreakerThreshold: 5
});

// Execute commands with automatic retry and circuit breaking
const value = await cluster.executeCommand('get', 'mykey');
await cluster.executeCommand('set', 'mykey', 'myvalue', 'EX', 3600);

// Get cluster statistics
const stats = await cluster.getStats();
console.log(`Connected nodes: ${stats.connectedNodes}/${stats.totalNodes}`);
console.log(`Health: ${stats.health}`);

// Get performance metrics
const metrics = cluster.getMetrics();
console.log(`P95 latency: ${metrics.latency.p95}ms`);
console.log(`Success rate: ${metrics.commands.successful / metrics.commands.total * 100}%`);
```

### 3. Integration with Multi-Layer Cache

```typescript
import {
  RedisClusterClient,
  createRedisCluster,
  parseClusterNodes,
  RedisCircuitBreaker,
  MultiLayerCache
} from '@discord-bot/cache';

// Create cluster
const nodes = parseClusterNodes(process.env.REDIS_CLUSTER_NODES!);
const cluster = createRedisCluster(nodes);

// Wrap with circuit breaker for multi-layer cache
const redisCircuitBreaker = new RedisCircuitBreaker({
  redis: cluster.getCluster(), // Get underlying cluster instance
  failureThreshold: 5,
  resetTimeout: 60000
});

// Create multi-layer cache
const cache = new MultiLayerCache('my-cache', redisCircuitBreaker, {
  memory: {
    maxSize: 1000,
    defaultTTL: 300000, // 5 minutes
    cleanupInterval: 60000
  },
  redis: {
    defaultTTL: 3600, // 1 hour
    keyPrefix: 'app:'
  }
});

// Use cache
const result = await cache.getOrSet('user:123', async () => {
  return await fetchUserFromDatabase('123');
});
```

## Advanced Configuration

### Connection Pooling

```typescript
const cluster = createRedisCluster(nodes, {
  redisOptions: {
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    commandTimeout: 5000,
    keepAlive: 30000,
    enableReadyCheck: true,
    enableOfflineQueue: true
  }
});
```

### Circuit Breaker Tuning

```typescript
const cluster = createRedisCluster(nodes, {
  // Open circuit after 5 consecutive failures
  circuitBreakerThreshold: 5,

  // Keep circuit open for 60 seconds
  circuitBreakerTimeout: 60000,

  // Retry failed commands up to 3 times
  maxRetries: 3,

  // Wait 1 second between retries
  retryDelay: 1000
});

// Check circuit breaker status
if (cluster.isCircuitBreakerOpen()) {
  console.warn('Circuit breaker is open - degraded mode');
}

// Manually reset circuit breaker
cluster.manualResetCircuitBreaker();
```

### Health Monitoring

```typescript
const cluster = createRedisCluster(nodes, {
  // Check health every 30 seconds
  healthCheckInterval: 30000,

  // Health check timeout
  healthCheckTimeout: 5000
});

// Get cluster statistics
const stats = await cluster.getStats();

console.log('Cluster Statistics:');
console.log(`Total nodes: ${stats.totalNodes}`);
console.log(`Connected nodes: ${stats.connectedNodes}`);
console.log(`Master nodes: ${stats.masterNodes}`);
console.log(`Slave nodes: ${stats.slaveNodes}`);
console.log(`Health: ${stats.health}`); // healthy | degraded | unhealthy

// Per-node statistics
stats.nodes.forEach(node => {
  console.log(`Node ${node.host}:${node.port}`);
  console.log(`  Role: ${node.role}`);
  console.log(`  Status: ${node.status}`);
  console.log(`  Memory: ${node.usedMemoryHuman}`);
  console.log(`  Clients: ${node.connectedClients}`);
});
```

## Kubernetes Deployment

### Redis Cluster StatefulSet

```yaml
# k8s/redis-cluster-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-cluster
  namespace: discord-bot
spec:
  serviceName: redis-cluster
  replicas: 6  # 3 masters + 3 slaves
  selector:
    matchLabels:
      app: redis-cluster
  template:
    metadata:
      labels:
        app: redis-cluster
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        command:
        - redis-server
        - --cluster-enabled
        - "yes"
        - --cluster-config-file
        - /data/nodes.conf
        - --cluster-node-timeout
        - "5000"
        - --appendonly
        - "yes"
        ports:
        - containerPort: 6379
          name: client
        - containerPort: 16379
          name: gossip
        volumeMounts:
        - name: data
          mountPath: /data
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 1000m
            memory: 2Gi
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 5Gi
```

### Service for Redis Cluster

```yaml
# k8s/redis-cluster-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: redis-cluster
  namespace: discord-bot
spec:
  clusterIP: None
  ports:
  - port: 6379
    targetPort: 6379
    name: client
  - port: 16379
    targetPort: 16379
    name: gossip
  selector:
    app: redis-cluster
```

### Initialize Cluster

```bash
# Wait for all pods to be ready
kubectl wait --for=condition=ready pod -l app=redis-cluster -n discord-bot --timeout=300s

# Get pod IPs
PODS=$(kubectl get pods -l app=redis-cluster -n discord-bot -o jsonpath='{range.items[*]}{.status.podIP}:6379 ')

# Create cluster (3 masters, 1 replica each)
kubectl exec -it redis-cluster-0 -n discord-bot -- redis-cli --cluster create $PODS --cluster-replicas 1
```

## Production Checklist

### High Availability

- [x] At least 3 master nodes
- [x] At least 1 replica per master
- [x] Circuit breaker configured
- [x] Health checks enabled
- [x] Automatic failover tested

### Performance

- [x] Connection pooling enabled
- [x] Read scaling to slaves
- [x] Metrics collection active
- [x] Latency monitoring < 50ms p95

### Monitoring

```typescript
// Expose cluster metrics for Prometheus
app.get('/metrics/redis-cluster', async (req, res) => {
  const stats = await cluster.getStats();
  const metrics = cluster.getMetrics();

  res.send(`
# HELP redis_cluster_nodes Total number of cluster nodes
# TYPE redis_cluster_nodes gauge
redis_cluster_nodes{status="total"} ${stats.totalNodes}
redis_cluster_nodes{status="connected"} ${stats.connectedNodes}
redis_cluster_nodes{status="master"} ${stats.masterNodes}
redis_cluster_nodes{status="slave"} ${stats.slaveNodes}

# HELP redis_cluster_health Cluster health status (2=healthy, 1=degraded, 0=unhealthy)
# TYPE redis_cluster_health gauge
redis_cluster_health ${stats.health === 'healthy' ? 2 : stats.health === 'degraded' ? 1 : 0}

# HELP redis_cluster_commands_total Total number of Redis commands
# TYPE redis_cluster_commands_total counter
redis_cluster_commands_total{status="total"} ${metrics.commands.total}
redis_cluster_commands_total{status="successful"} ${metrics.commands.successful}
redis_cluster_commands_total{status="failed"} ${metrics.commands.failed}
redis_cluster_commands_total{status="retried"} ${metrics.commands.retried}

# HELP redis_cluster_latency_seconds Command latency in seconds
# TYPE redis_cluster_latency_seconds gauge
redis_cluster_latency_seconds{quantile="0.5"} ${metrics.latency.p50 / 1000}
redis_cluster_latency_seconds{quantile="0.95"} ${metrics.latency.p95 / 1000}
redis_cluster_latency_seconds{quantile="0.99"} ${metrics.latency.p99 / 1000}
redis_cluster_latency_seconds{quantile="avg"} ${metrics.latency.avg / 1000}
  `.trim());
});
```

## Troubleshooting

### Circuit Breaker Open

**Symptom**: Commands fail with "Circuit breaker is open"

**Solutions**:
1. Check cluster health: `await cluster.getStats()`
2. Verify node connectivity
3. Manually reset circuit breaker: `cluster.manualResetCircuitBreaker()`
4. Increase threshold: `circuitBreakerThreshold: 10`

### High Latency

**Symptom**: P95 latency > 100ms

**Solutions**:
1. Check metrics: `cluster.getMetrics()`
2. Verify network between services and Redis
3. Check Redis memory usage (may be swapping)
4. Add more cluster nodes for horizontal scaling

### Node Failures

**Symptom**: Nodes disconnecting frequently

**Solutions**:
1. Check node logs: `kubectl logs redis-cluster-0 -n discord-bot`
2. Verify resource limits (CPU/memory)
3. Check network policies allow cluster gossip (port 16379)
4. Ensure persistent volumes are healthy

### Connection Errors

**Symptom**: "Unable to connect to cluster"

**Solutions**:
1. Verify environment variables: `REDIS_CLUSTER_NODES`
2. Check service endpoints: `kubectl get endpoints redis-cluster -n discord-bot`
3. Verify network policies allow egress to Redis
4. Check Redis cluster status: `redis-cli cluster info`

## Migration from Single Redis

### Step 1: Deploy Redis Cluster

```bash
# Deploy cluster alongside existing Redis
kubectl apply -f k8s/redis-cluster-statefulset.yaml
kubectl apply -f k8s/redis-cluster-service.yaml

# Initialize cluster
# (see Initialize Cluster section above)
```

### Step 2: Dual-Write Configuration

```typescript
import { createRedisCluster } from '@discord-bot/cache';
import Redis from 'ioredis';

// Keep existing Redis client
const singleRedis = new Redis(process.env.REDIS_URL);

// Add cluster client
const cluster = createRedisCluster(
  parseClusterNodes(process.env.REDIS_CLUSTER_NODES!)
);

// Dual-write wrapper
async function setWithDualWrite(key: string, value: string) {
  await Promise.all([
    singleRedis.set(key, value),
    cluster.executeCommand('set', key, value)
  ]);
}

// Read from cluster (fallback to single)
async function getWithFallback(key: string): Promise<string | null> {
  try {
    return await cluster.executeCommand('get', key);
  } catch (error) {
    logger.warn('Cluster read failed, falling back to single Redis');
    return await singleRedis.get(key);
  }
}
```

### Step 3: Monitor and Migrate

1. Monitor cluster metrics for 24 hours
2. Verify data consistency
3. Gradually increase read traffic to cluster
4. Once stable, migrate writes to cluster-only
5. Decommission single Redis instance

## Best Practices

### 1. Use Circuit Breaker

Always use the circuit breaker pattern to prevent cascading failures:

```typescript
if (cluster.isCircuitBreakerOpen()) {
  // Fallback to cached data or default values
  return getCachedValueOrDefault();
}
```

### 2. Monitor Metrics

Set up alerts for:
- Circuit breaker open (critical)
- Cluster health degraded (warning)
- P95 latency > 100ms (warning)
- Failed command rate > 1% (critical)

### 3. Graceful Shutdown

```typescript
process.on('SIGTERM', async () => {
  logger.info('Shutting down gracefully...');
  await cluster.disconnect();
  process.exit(0);
});
```

### 4. Connection Limits

Ensure your cluster can handle concurrent connections:
- Gateway service: 3-10 pods × 25 connections = 75-250 connections
- Audio service: 5-20 pods × 25 connections = 125-500 connections
- Total: ~200-750 concurrent connections

Configure Redis: `maxclients 10000`

## References

- [Redis Cluster Tutorial](https://redis.io/docs/manual/scaling/)
- [ioredis Cluster Documentation](https://github.com/redis/ioredis#cluster)
- [Redis Cluster Specification](https://redis.io/docs/reference/cluster-spec/)
