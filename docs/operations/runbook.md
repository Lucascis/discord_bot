# Operations Runbook

**Discord Music Bot - Production Operations Guide**

**Version**: 1.0.0
**Last Updated**: 2025-11-03
**Owner**: DevOps Team

---

## Table of Contents

1. [Overview](#overview)
2. [Emergency Contacts](#emergency-contacts)
3. [Common Issues](#common-issues)
4. [Debugging Procedures](#debugging-procedures)
5. [Recovery Procedures](#recovery-procedures)
6. [Maintenance Tasks](#maintenance-tasks)
7. [Escalation Procedures](#escalation-procedures)

---

## Overview

This runbook provides step-by-step procedures for diagnosing and resolving common operational issues with the Discord Music Bot system.

### System Architecture Quick Reference

```
External → Ingress → API/Gateway/Audio → PostgreSQL/Redis/Lavalink → Music APIs
```

### Key Services

| Service | Port | Purpose | Critical? |
|---------|------|---------|-----------|
| Gateway | 3001 | Discord interactions | ✅ Critical |
| Audio | 3002 | Music playback | ✅ Critical |
| API | 3000 | REST endpoints | Medium |
| Worker | 3003 | Background jobs | Low |
| Lavalink | 2333 | Audio processing | ✅ Critical |
| PostgreSQL | 5432 | Database | ✅ Critical |
| Redis | 6379 | Cache & Pub/Sub | ✅ Critical |

---

## Emergency Contacts

### On-Call Rotation

- **Primary**: DevOps Team (Slack: #devops-oncall)
- **Secondary**: Backend Team (Slack: #backend-oncall)
- **Escalation**: Engineering Manager

### External Services

- **Discord**: https://status.discord.com
- **Stripe**: https://status.stripe.com
- **GCP/AWS Status**: Check provider status page
- **Sentry**: Dashboard for error tracking

---

## Common Issues

### Issue 1: Bot Not Responding to Commands

**Symptoms**:
- Users report bot not responding to slash commands
- Gateway service logs show errors or no activity

**Diagnosis**:
```bash
# Check Gateway pods
kubectl get pods -n discord-bot -l app=discord-gateway

# Check Gateway logs
kubectl logs -f deployment/discord-gateway -n discord-bot --tail=100

# Check Discord API status
curl https://status.discord.com/api/v2/status.json
```

**Common Causes**:
1. Discord API outage
2. Gateway pods not running
3. Invalid Discord token
4. Network policy blocking Discord API

**Resolution**:

**If Discord API is down**:
- Monitor https://status.discord.com
- Post update in #incidents Slack channel
- Wait for Discord to resolve

**If Gateway pods are crashed**:
```bash
# Check pod status
kubectl describe pod <pod-name> -n discord-bot

# Check recent events
kubectl get events -n discord-bot --sort-by='.lastTimestamp' | head -20

# Restart deployment
kubectl rollout restart deployment/discord-gateway -n discord-bot

# Watch rollout status
kubectl rollout status deployment/discord-gateway -n discord-bot
```

**If invalid Discord token**:
```bash
# Verify secret exists
kubectl get secret discord-bot-secrets -n discord-bot

# Update token
kubectl create secret generic discord-bot-secrets \
  --from-literal=DISCORD_TOKEN="new-token" \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart gateway to pick up new token
kubectl rollout restart deployment/discord-gateway -n discord-bot
```

**If network policy blocking**:
```bash
# Test connectivity from pod
kubectl exec -it <gateway-pod> -n discord-bot -- nc -zv discord.com 443

# Temporarily disable network policy for testing
kubectl delete networkpolicy discord-gateway-netpol -n discord-bot

# If this fixes it, review and update network policy
kubectl apply -f k8s/network-policy.yaml
```

---

### Issue 2: Music Not Playing / Audio Issues

**Symptoms**:
- Bot joins voice channel but no audio plays
- Audio cuts out or stutters
- Lavalink connection errors in logs

**Diagnosis**:
```bash
# Check Lavalink pods
kubectl get pods -n discord-bot -l app=lavalink

# Check Lavalink logs
kubectl logs -f deployment/lavalink -n discord-bot --tail=100

# Check Audio service logs
kubectl logs -f deployment/discord-audio -n discord-bot --tail=100

# Check player status (if Lavalink exposes API)
kubectl port-forward -n discord-bot svc/lavalink 2333:2333
curl http://localhost:2333/version
```

**Common Causes**:
1. Lavalink pods not running
2. YouTube API rate limited
3. Network issues to music APIs
4. Voice connection not established

**Resolution**:

**If Lavalink pods crashed**:
```bash
# Check crash reason
kubectl describe pod <lavalink-pod> -n discord-bot

# Common: OOMKilled
# Check memory usage
kubectl top pod -n discord-bot -l app=lavalink

# If OOMKilled, increase memory limits
kubectl edit deployment lavalink -n discord-bot
# Edit: resources.limits.memory: "4Gi"

# Restart
kubectl rollout restart deployment/lavalink -n discord-bot
```

**If YouTube rate limited**:
```bash
# Check Lavalink logs for "429" or "rate limit"
kubectl logs deployment/lavalink -n discord-bot | grep -i "429\|rate"

# Temporary: Use alternative sources (Spotify, SoundCloud)
# Long-term: Implement rotating proxies or multiple API keys

# Check if YouTube plugin is configured correctly
kubectl exec -it <lavalink-pod> -n discord-bot -- cat /opt/Lavalink/application.yml
```

**If voice connection issues**:
```bash
# Check if VOICE_SERVER_UPDATE events are being forwarded
kubectl logs deployment/discord-gateway -n discord-bot | grep "VOICE_SERVER_UPDATE"

# Check Redis pub/sub
kubectl exec -it redis-0 -n discord-bot -- redis-cli
> SUBSCRIBE discord-bot:to-audio
# (Should see events when bot joins voice)

# Restart audio service
kubectl rollout restart deployment/discord-audio -n discord-bot
```

---

### Issue 3: Database Connection Issues

**Symptoms**:
- Services unable to query database
- "Connection pool exhausted" errors
- Slow query performance

**Diagnosis**:
```bash
# Check PostgreSQL pod
kubectl get pod postgres-0 -n discord-bot

# Check PostgreSQL logs
kubectl logs postgres-0 -n discord-bot --tail=100

# Check connections
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Check long-running queries
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT pid, now() - query_start as duration, query FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC;"
```

**Common Causes**:
1. PostgreSQL pod not running
2. Connection pool exhausted
3. Slow queries blocking others
4. Disk space full

**Resolution**:

**If PostgreSQL pod crashed**:
```bash
# Check pod status
kubectl describe pod postgres-0 -n discord-bot

# Check PVC status
kubectl get pvc -n discord-bot

# If PVC issue, may need to restore from backup
# See "Data Recovery" section

# Restart pod
kubectl delete pod postgres-0 -n discord-bot
# StatefulSet will recreate it
```

**If connection pool exhausted**:
```bash
# Check active connections
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Kill idle connections
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';"

# Increase max_connections (restart required)
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "ALTER SYSTEM SET max_connections = 200;"
kubectl delete pod postgres-0 -n discord-bot

# Update application connection pools
# Edit configmap or environment variables
```

**If slow queries**:
```bash
# Find slow queries
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT pid, now() - query_start as duration, query FROM pg_stat_activity WHERE state = 'active' AND query_start < now() - interval '30 seconds';"

# Kill specific slow query
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT pg_cancel_backend(<pid>);"

# Add indexes if needed
# Review query execution plans
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres discord -c "EXPLAIN ANALYZE <query>;"
```

**If disk full**:
```bash
# Check PVC usage
kubectl exec -it postgres-0 -n discord-bot -- df -h

# Option 1: Expand PVC (if storage class supports)
kubectl edit pvc postgres-data-postgres-0 -n discord-bot
# Edit: spec.resources.requests.storage: "20Gi"

# Option 2: Clean up old data
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres discord -c "VACUUM FULL;"

# Option 3: Archive old data
```

---

### Issue 4: Redis Connection Issues

**Symptoms**:
- "Connection refused" errors
- Pub/sub messages not delivered
- Cache misses causing slow performance

**Diagnosis**:
```bash
# Check Redis pod
kubectl get pod redis-0 -n discord-bot

# Check Redis logs
kubectl logs redis-0 -n discord-bot --tail=100

# Test Redis connectivity
kubectl exec -it redis-0 -n discord-bot -- redis-cli ping
# Should return: PONG

# Check memory usage
kubectl exec -it redis-0 -n discord-bot -- redis-cli INFO memory
```

**Common Causes**:
1. Redis pod not running
2. Memory limit exceeded
3. Network policy blocking
4. AOF corruption

**Resolution**:

**If Redis pod crashed**:
```bash
# Check crash reason
kubectl describe pod redis-0 -n discord-bot

# If OOMKilled
kubectl exec -it redis-0 -n discord-bot -- redis-cli INFO memory

# Increase maxmemory
kubectl edit configmap redis-config -n discord-bot
# Edit: maxmemory 800mb

# Restart
kubectl delete pod redis-0 -n discord-bot
```

**If memory exceeded**:
```bash
# Check current memory usage
kubectl exec -it redis-0 -n discord-bot -- redis-cli INFO memory

# Force eviction
kubectl exec -it redis-0 -n discord-bot -- redis-cli FLUSHDB

# Or clear specific pattern
kubectl exec -it redis-0 -n discord-bot -- redis-cli --scan --pattern 'temp:*' | xargs kubectl exec -it redis-0 -n discord-bot -- redis-cli DEL
```

**If AOF corrupted**:
```bash
# Check AOF status
kubectl exec -it redis-0 -n discord-bot -- redis-cli BGREWRITEAOF

# If corrupted, repair
kubectl exec -it redis-0 -n discord-bot -- redis-check-aof --fix /data/appendonly.aof

# Restart Redis
kubectl delete pod redis-0 -n discord-bot
```

---

### Issue 5: High Latency / Slow Performance

**Symptoms**:
- Commands take >5 seconds to respond
- Music playback delays
- UI updates slow

**Diagnosis**:
```bash
# Check HPA status
kubectl get hpa -n discord-bot

# Check pod resource usage
kubectl top pods -n discord-bot

# Check node resource usage
kubectl top nodes

# Check application metrics
kubectl port-forward -n discord-bot svc/discord-api 3000:3000
curl http://localhost:3000/metrics | grep latency
```

**Common Causes**:
1. Insufficient resources
2. Database slow queries
3. External API slowness
4. Network congestion

**Resolution**:

**If insufficient CPU/Memory**:
```bash
# Scale up manually
kubectl scale deployment discord-audio --replicas=10 -n discord-bot

# Or update HPA targets
kubectl edit hpa discord-audio-hpa -n discord-bot
# Edit: targetCPUUtilizationPercentage: 60

# Or increase resource limits
kubectl edit deployment discord-audio -n discord-bot
# Edit resources.limits
```

**If database slow**:
```bash
# See "Issue 3: Database Connection Issues" above
# Check for missing indexes
# Optimize slow queries
```

**If external API slow**:
```bash
# Check Lavalink logs for slow API calls
kubectl logs deployment/lavalink -n discord-bot | grep -i "slow\|timeout"

# Implement caching
# Add circuit breakers
# Use alternative APIs
```

---

### Issue 6: Subscription/Payment Issues

**Symptoms**:
- Stripe webhooks failing
- Subscription not activating
- Payment succeeded but features not unlocked

**Diagnosis**:
```bash
# Check API logs
kubectl logs deployment/discord-api -n discord-bot | grep -i "stripe\|webhook"

# Check Stripe dashboard for webhook delivery status
# https://dashboard.stripe.com/webhooks

# Check database subscriptions
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres discord -c "SELECT * FROM subscriptions WHERE \"guildId\" = '<guild-id>';"
```

**Common Causes**:
1. Webhook signature verification failing
2. Network timeout
3. Database write failure
4. Cache not invalidated

**Resolution**:

**If webhook signature fails**:
```bash
# Verify webhook secret is correct
kubectl get secret discord-bot-secrets -n discord-bot -o jsonpath='{.data.STRIPE_WEBHOOK_SECRET}' | base64 -d

# Update secret if needed
kubectl create secret generic discord-bot-secrets \
  --from-literal=STRIPE_WEBHOOK_SECRET="whsec_..." \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart API
kubectl rollout restart deployment/discord-api -n discord-bot
```

**If webhook timeout**:
```bash
# Stripe has 30s timeout
# Check if webhook processing is slow
kubectl logs deployment/discord-api -n discord-bot | grep "webhook processing time"

# Optimize webhook handler
# Process asynchronously if needed
```

**If subscription not activated**:
```bash
# Manually activate (emergency only)
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres discord

UPDATE subscriptions
SET
  tier = 'PREMIUM',
  status = 'ACTIVE',
  "currentPeriodEnd" = NOW() + INTERVAL '30 days'
WHERE "guildId" = '<guild-id>';

# Invalidate cache
kubectl exec -it redis-0 -n discord-bot -- redis-cli DEL "features:<guild-id>"
kubectl exec -it redis-0 -n discord-bot -- redis-cli DEL "subscription:<guild-id>"

# Publish event
kubectl exec -it redis-0 -n discord-bot -- redis-cli PUBLISH discord-bot:events '{"type":"subscriptionUpgraded","guildId":"<guild-id>","tier":"PREMIUM"}'
```

---

## Debugging Procedures

### Getting Pod Logs

```bash
# Recent logs
kubectl logs <pod-name> -n discord-bot --tail=100

# Follow logs in real-time
kubectl logs -f <pod-name> -n discord-bot

# Previous container logs (if crashed)
kubectl logs <pod-name> -n discord-bot --previous

# All pods in deployment
kubectl logs -f deployment/discord-gateway -n discord-bot

# With timestamp
kubectl logs <pod-name> -n discord-bot --timestamps

# Specific time range (requires node access)
kubectl logs <pod-name> -n discord-bot --since=1h
```

### Exec into Pod

```bash
# Interactive shell
kubectl exec -it <pod-name> -n discord-bot -- /bin/sh

# Run single command
kubectl exec <pod-name> -n discord-bot -- env

# Test network connectivity
kubectl exec -it <pod-name> -n discord-bot -- nc -zv postgres 5432
kubectl exec -it <pod-name> -n discord-bot -- nc -zv redis 6379
kubectl exec -it <pod-name> -n discord-bot -- curl https://discord.com
```

### Check Resource Usage

```bash
# Pod resource usage
kubectl top pods -n discord-bot

# Node resource usage
kubectl top nodes

# Detailed pod info
kubectl describe pod <pod-name> -n discord-bot

# Events
kubectl get events -n discord-bot --sort-by='.lastTimestamp'
```

### Trace Request Flow

```bash
# 1. User sends command
# 2. Discord sends event to Gateway

kubectl logs -f deployment/discord-gateway -n discord-bot | grep "INTERACTION_CREATE"

# 3. Gateway publishes to Redis
kubectl exec -it redis-0 -n discord-bot -- redis-cli
> MONITOR
# Watch for PUBLISH discord-bot:commands

# 4. Audio service receives command
kubectl logs -f deployment/discord-audio -n discord-bot | grep "Received command"

# 5. Audio queries database
kubectl logs postgres-0 -n discord-bot | grep "SELECT.*queue"

# 6. Audio connects to Lavalink
kubectl logs -f deployment/lavalink -n discord-bot | grep "player"

# 7. Audio publishes UI update
kubectl logs -f deployment/discord-audio -n discord-bot | grep "Publishing UI update"

# 8. Gateway receives UI update and sends to Discord
kubectl logs -f deployment/discord-gateway -n discord-bot | grep "Updating message"
```

---

## Recovery Procedures

### Database Recovery from Backup

```bash
# 1. Create backup (regular maintenance)
kubectl exec postgres-0 -n discord-bot -- pg_dump -U postgres discord > backup-$(date +%Y%m%d).sql

# 2. Restore from backup
# Stop services accessing database
kubectl scale deployment discord-gateway --replicas=0 -n discord-bot
kubectl scale deployment discord-audio --replicas=0 -n discord-bot
kubectl scale deployment discord-api --replicas=0 -n discord-bot

# Drop and recreate database
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "DROP DATABASE discord;"
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "CREATE DATABASE discord;"

# Restore
kubectl exec -i postgres-0 -n discord-bot -- psql -U postgres discord < backup-20251103.sql

# Restart services
kubectl scale deployment discord-gateway --replicas=3 -n discord-bot
kubectl scale deployment discord-audio --replicas=5 -n discord-bot
kubectl scale deployment discord-api --replicas=2 -n discord-bot
```

### Redis Recovery

```bash
# Redis uses AOF persistence, should auto-recover on restart

# If data loss acceptable
kubectl exec -it redis-0 -n discord-bot -- redis-cli FLUSHALL

# If AOF corrupted
kubectl exec redis-0 -n discord-bot -- redis-check-aof --fix /data/appendonly.aof
kubectl delete pod redis-0 -n discord-bot
```

### Service Rollback

```bash
# Rollback to previous deployment
kubectl rollout undo deployment/discord-gateway -n discord-bot

# Rollback to specific revision
kubectl rollout history deployment/discord-gateway -n discord-bot
kubectl rollout undo deployment/discord-gateway --to-revision=2 -n discord-bot

# Check rollout status
kubectl rollout status deployment/discord-gateway -n discord-bot
```

---

## Maintenance Tasks

### Weekly Tasks

1. **Check logs for errors**
```bash
kubectl logs deployment/discord-gateway -n discord-bot --since=168h | grep -i error
```

2. **Review metrics**
- Check Grafana dashboards
- Review error rates in Sentry
- Check database query performance

3. **Update dependencies** (if needed)
```bash
# In development environment
pnpm update
pnpm audit
```

### Monthly Tasks

1. **Database maintenance**
```bash
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres discord -c "VACUUM ANALYZE;"
```

2. **Backup verification**
- Test restore from backup
- Verify backup exists and is accessible

3. **Review and rotate secrets**
```bash
# Update API keys if needed
# Rotate database passwords
# Update Discord bot token if compromised
```

### Quarterly Tasks

1. **Capacity planning review**
- Review HPA metrics
- Plan for growth
- Adjust resource limits

2. **Security audit**
- Review network policies
- Check for CVEs
- Update dependencies

3. **Disaster recovery drill**
- Simulate outage
- Test recovery procedures
- Update runbook

---

## Escalation Procedures

### Severity Levels

**SEV1 - Critical**:
- Service completely down
- Data loss occurring
- Security breach

**Actions**:
1. Page on-call immediately
2. Post in #incidents
3. Escalate to manager after 30 minutes

**SEV2 - High**:
- Partial outage
- Degraded performance
- Feature not working

**Actions**:
1. Notify on-call
2. Post in #incidents
3. Escalate if not resolved in 2 hours

**SEV3 - Medium**:
- Minor issue
- Workaround available
- Non-critical feature

**Actions**:
1. Create ticket
2. Fix in next sprint

---

## Additional Resources

- [Kubernetes Deployment Guide](../KUBERNETES_DEPLOYMENT_GUIDE.md)
- [Architecture Diagrams](../architecture/diagrams/)
- [Monitoring Dashboards](https://grafana.example.com/dashboards)
- [Error Tracking](https://sentry.io/organizations/discord-bot)

---

**Last Updated**: 2025-11-03
**Next Review**: 2025-12-03
