# Kubernetes Deployment Guide

**Discord Music Bot - Production-Grade Kubernetes Deployment**

**Version**: 1.0.0
**Author**: Discord Bot Team
**Last Updated**: 2025-11-03
**Status**: Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Architecture](#architecture)
4. [Quick Start](#quick-start)
5. [Detailed Deployment Steps](#detailed-deployment-steps)
6. [Configuration](#configuration)
7. [Monitoring](#monitoring)
8. [Scaling](#scaling)
9. [Troubleshooting](#troubleshooting)
10. [Maintenance](#maintenance)

---

## Overview

This guide covers deploying the Discord Music Bot to a production Kubernetes cluster with:

- **High Availability**: Multiple replicas with auto-scaling
- **Zero Downtime**: Rolling updates and PodDisruptionBudgets
- **Security**: RBAC, NetworkPolicies, and TLS
- **Observability**: Prometheus metrics and health checks
- **Scalability**: HPA configured for 10,000+ guilds

### Infrastructure Components

| Component | Type | Replicas | Auto-Scale |
|-----------|------|----------|------------|
| Gateway | Deployment | 3 | 3-10 |
| Audio | Deployment | 5 | 5-20 |
| API | Deployment | 2 | 2-8 |
| Worker | Deployment | 2 | 2-6 |
| Lavalink | Deployment | 3 | 3-10 |
| PostgreSQL | StatefulSet | 1 | Manual |
| Redis | StatefulSet | 1 | Manual |

### Resource Requirements

**Minimum Cluster**:
- **Nodes**: 3 (for HA)
- **CPU**: 12 cores total
- **Memory**: 16GB total
- **Storage**: 50GB persistent storage

**Recommended Production**:
- **Nodes**: 5-10 (with node pools)
- **CPU**: 32+ cores total
- **Memory**: 64GB+ total
- **Storage**: 200GB persistent storage (SSD)

---

## Prerequisites

### 1. Kubernetes Cluster

Supported platforms:
- **GKE** (Google Kubernetes Engine) - Recommended
- **EKS** (Amazon Elastic Kubernetes Service)
- **AKS** (Azure Kubernetes Service)
- **Self-hosted** (kubeadm, k3s, etc.)
- **Local testing** (minikube, kind)

Minimum version: Kubernetes 1.24+

### 2. Required Tools

```bash
# kubectl - Kubernetes CLI
kubectl version --client

# helm (optional, for monitoring stack)
helm version

# docker - For building images
docker --version
```

### 3. Cluster Addons

Ensure your cluster has:

- **CNI Plugin** with NetworkPolicy support (Calico, Cilium, Weave)
- **Metrics Server** (for HPA)
- **Ingress Controller** (NGINX recommended)
- **StorageClass** (for PersistentVolumes)

Verify:
```bash
# Check metrics server
kubectl top nodes

# Check ingress controller
kubectl get pods -n ingress-nginx

# Check storage classes
kubectl get storageclass
```

---

## Architecture

### Service Communication Flow

```
External Users
     ↓
  Ingress (NGINX)
     ↓
   API Service ←→ Gateway Service ←→ Audio Service
     ↓              ↓                     ↓
     └──────────────┴──────────┬──────────┘
                                ↓
                    ┌───────────┴───────────┐
                    ↓                       ↓
              PostgreSQL                Redis
                    ↑                       ↑
                    └───────────┬───────────┘
                                ↓
                           Lavalink
                                ↓
                    External Music APIs
                  (YouTube, Spotify, etc.)
```

### Network Policies

Zero-trust network segmentation:
- **Default**: Deny all traffic
- **Explicit Allow**: Only required communication paths
- **Database Isolation**: No direct external access
- **Monitoring**: Prometheus can scrape all services

### High Availability Strategy

1. **Multiple Replicas**: All stateless services have 2+ replicas
2. **Anti-Affinity**: Pods spread across different nodes
3. **PodDisruptionBudgets**: Ensure minimum availability during maintenance
4. **Health Checks**: Liveness and readiness probes for all services
5. **Persistent Storage**: StatefulSets for databases with PVCs

---

## Quick Start

### For Local Testing (Minikube)

```bash
# 1. Start minikube with sufficient resources
minikube start --cpus=4 --memory=8192 --disk-size=50g

# 2. Enable required addons
minikube addons enable ingress
minikube addons enable metrics-server

# 3. Build and load Docker images
eval $(minikube docker-env)
docker-compose build

# 4. Create namespace
kubectl apply -f k8s/namespace.yaml

# 5. Create secrets
cp k8s/secrets.yaml.example k8s/secrets.yaml
# Edit k8s/secrets.yaml with your actual secrets
kubectl apply -f k8s/secrets.yaml

# 6. Deploy all resources
kubectl apply -f k8s/

# 7. Wait for pods to be ready
kubectl wait --for=condition=ready pod -l tier=application -n discord-bot --timeout=300s

# 8. Check status
kubectl get pods -n discord-bot
kubectl get svc -n discord-bot
kubectl get hpa -n discord-bot

# 9. Access API (port-forward for testing)
kubectl port-forward -n discord-bot svc/discord-api 3000:3000
```

### For Production Cluster

```bash
# 1. Create namespace
kubectl apply -f k8s/namespace.yaml

# 2. Create secrets (from secure vault)
kubectl create secret generic discord-bot-secrets \
  --from-literal=DISCORD_TOKEN="${DISCORD_TOKEN}" \
  --from-literal=DATABASE_URL="${DATABASE_URL}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=LAVALINK_PASSWORD="${LAVALINK_PASSWORD}" \
  --from-literal=SPOTIFY_CLIENT_ID="${SPOTIFY_CLIENT_ID}" \
  --from-literal=SPOTIFY_CLIENT_SECRET="${SPOTIFY_CLIENT_SECRET}" \
  -n discord-bot

# 3. Create TLS certificate (if using cert-manager)
kubectl apply -f k8s/ingress.yaml  # Will auto-provision certificate

# 4. Deploy infrastructure (databases first)
kubectl apply -f k8s/postgres-statefulset.yaml
kubectl apply -f k8s/redis-statefulset.yaml

# Wait for databases to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n discord-bot --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n discord-bot --timeout=300s

# 5. Deploy Lavalink
kubectl apply -f k8s/lavalink-deployment.yaml
kubectl wait --for=condition=ready pod -l app=lavalink -n discord-bot --timeout=300s

# 6. Deploy application services
kubectl apply -f k8s/gateway-deployment.yaml
kubectl apply -f k8s/audio-deployment.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml

# 7. Deploy security and networking
kubectl apply -f k8s/rbac.yaml
kubectl apply -f k8s/network-policy.yaml
kubectl apply -f k8s/pdb.yaml

# 8. Verify deployment
kubectl get all -n discord-bot
kubectl get hpa -n discord-bot
kubectl get pdb -n discord-bot
kubectl get networkpolicy -n discord-bot
```

---

## Detailed Deployment Steps

### Step 1: Prepare Secrets

**Never commit secrets to git!**

Create `k8s/secrets.yaml` from the example:

```bash
cp k8s/secrets.yaml.example k8s/secrets.yaml
```

Edit the file with your actual values:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: discord-bot-secrets
  namespace: discord-bot
type: Opaque
stringData:
  DISCORD_TOKEN: "YOUR_DISCORD_BOT_TOKEN"
  DATABASE_URL: "postgresql://user:password@postgres:5432/discord"
  POSTGRES_USER: "discord"
  POSTGRES_PASSWORD: "SECURE_PASSWORD"
  REDIS_PASSWORD: "SECURE_PASSWORD"
  LAVALINK_PASSWORD: "SECURE_PASSWORD"
  SPOTIFY_CLIENT_ID: "YOUR_SPOTIFY_CLIENT_ID"
  SPOTIFY_CLIENT_SECRET: "YOUR_SPOTIFY_CLIENT_SECRET"
  SENTRY_DSN: "YOUR_SENTRY_DSN"  # Optional
```

Apply the secret:

```bash
kubectl apply -f k8s/secrets.yaml
```

Verify:

```bash
kubectl get secret discord-bot-secrets -n discord-bot
```

### Step 2: Configure Ingress

Edit [k8s/ingress.yaml](../k8s/ingress.yaml#L48) to set your domain:

```yaml
spec:
  tls:
  - hosts:
    - api.yourdomain.com  # Change this
    secretName: discord-bot-tls

  rules:
  - host: api.yourdomain.com  # Change this
```

If using **cert-manager** for automatic TLS:

```bash
# Install cert-manager (if not already installed)
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create ClusterIssuer for Let's Encrypt
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: nginx
EOF
```

### Step 3: Deploy Database Layer

Deploy PostgreSQL:

```bash
kubectl apply -f k8s/postgres-statefulset.yaml

# Wait for ready
kubectl wait --for=condition=ready pod postgres-0 -n discord-bot --timeout=300s

# Verify
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT version();"
```

Deploy Redis:

```bash
kubectl apply -f k8s/redis-statefulset.yaml

# Wait for ready
kubectl wait --for=condition=ready pod redis-0 -n discord-bot --timeout=300s

# Verify
kubectl exec -it redis-0 -n discord-bot -- redis-cli ping
# Expected output: PONG
```

### Step 4: Deploy Lavalink

```bash
kubectl apply -f k8s/lavalink-deployment.yaml

# Wait for ready
kubectl wait --for=condition=ready pod -l app=lavalink -n discord-bot --timeout=300s

# Verify
kubectl exec -it $(kubectl get pod -l app=lavalink -n discord-bot -o jsonpath='{.items[0].metadata.name}') -n discord-bot -- wget -qO- http://localhost:2333/version
```

### Step 5: Deploy Application Services

```bash
# Deploy all application services
kubectl apply -f k8s/gateway-deployment.yaml
kubectl apply -f k8s/audio-deployment.yaml
kubectl apply -f k8s/api-deployment.yaml
kubectl apply -f k8s/worker-deployment.yaml

# Wait for all to be ready
kubectl wait --for=condition=ready pod -l tier=application -n discord-bot --timeout=300s

# Verify
kubectl get pods -n discord-bot
```

Expected output:
```
NAME                              READY   STATUS    RESTARTS   AGE
discord-api-xxxxxxxxx-xxxxx       1/1     Running   0          2m
discord-api-xxxxxxxxx-xxxxx       1/1     Running   0          2m
discord-audio-xxxxxxxxx-xxxxx     1/1     Running   0          2m
discord-audio-xxxxxxxxx-xxxxx     1/1     Running   0          2m
discord-gateway-xxxxxxxxx-xxxxx   1/1     Running   0          2m
discord-gateway-xxxxxxxxx-xxxxx   1/1     Running   0          2m
discord-worker-xxxxxxxxx-xxxxx    1/1     Running   0          2m
lavalink-xxxxxxxxx-xxxxx          1/1     Running   0          5m
postgres-0                        1/1     Running   0          10m
redis-0                           1/1     Running   0          10m
```

### Step 6: Deploy Security Layer

```bash
# RBAC
kubectl apply -f k8s/rbac.yaml

# Network Policies
kubectl apply -f k8s/network-policy.yaml

# PodDisruptionBudgets
kubectl apply -f k8s/pdb.yaml

# Verify
kubectl get networkpolicy -n discord-bot
kubectl get pdb -n discord-bot
```

### Step 7: Deploy Ingress

```bash
kubectl apply -f k8s/ingress.yaml

# Wait for ingress IP
kubectl get ingress -n discord-bot -w

# Get ingress IP/hostname
kubectl get ingress discord-bot-ingress -n discord-bot -o jsonpath='{.status.loadBalancer.ingress[0]}'
```

Update your DNS to point to the ingress IP.

---

## Configuration

### Environment Variables

All configuration is managed via [k8s/configmap.yaml](../k8s/configmap.yaml):

```yaml
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  REDIS_URL: "redis://redis:6379"
  DATABASE_URL: "postgresql://postgres:5432/discord"
  LAVALINK_HOST: "lavalink"
  LAVALINK_PORT: "2333"
```

To update configuration:

```bash
# Edit configmap
kubectl edit configmap discord-bot-config -n discord-bot

# Restart pods to pick up changes
kubectl rollout restart deployment discord-gateway -n discord-bot
kubectl rollout restart deployment discord-audio -n discord-bot
kubectl rollout restart deployment discord-api -n discord-bot
kubectl rollout restart deployment discord-worker -n discord-bot
```

### Resource Limits

Adjust resource requests/limits in deployment files:

```yaml
resources:
  requests:
    memory: "512Mi"
    cpu: "1000m"
  limits:
    memory: "1Gi"
    cpu: "2000m"
```

### Auto-Scaling Thresholds

Adjust HPA settings for each service:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: discord-audio-hpa
spec:
  minReplicas: 5
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        averageUtilization: 70  # Scale when CPU > 70%
```

---

## Monitoring

### Health Checks

All services expose health endpoints:

- **Liveness**: `/health` - Pod is alive
- **Readiness**: `/ready` - Pod is ready to serve traffic

Test health endpoints:

```bash
# Port-forward to test
kubectl port-forward -n discord-bot svc/discord-api 3000:3000

# Test health
curl http://localhost:3000/health
curl http://localhost:3000/ready
```

### Prometheus Metrics

All services expose Prometheus metrics at `/metrics`:

```bash
# Check metrics
kubectl port-forward -n discord-bot svc/discord-api 3000:3000
curl http://localhost:3000/metrics
```

### Logs

View logs:

```bash
# View logs for a specific service
kubectl logs -f deployment/discord-gateway -n discord-bot

# View logs for all pods with label
kubectl logs -f -l app=discord-audio -n discord-bot

# View logs from previous container (if crashed)
kubectl logs deployment/discord-gateway -n discord-bot --previous

# Stream logs with stern (if installed)
stern discord -n discord-bot
```

### Events

Monitor cluster events:

```bash
# Watch events in namespace
kubectl get events -n discord-bot --watch

# Get events for a specific pod
kubectl describe pod <pod-name> -n discord-bot
```

---

## Scaling

### Manual Scaling

```bash
# Scale deployment
kubectl scale deployment discord-audio --replicas=10 -n discord-bot

# Scale StatefulSet (PostgreSQL)
kubectl scale statefulset postgres --replicas=3 -n discord-bot

# Verify
kubectl get pods -n discord-bot
```

### Auto-Scaling (HPA)

HPA automatically scales based on CPU/memory:

```bash
# View HPA status
kubectl get hpa -n discord-bot

# Describe HPA
kubectl describe hpa discord-audio-hpa -n discord-bot

# Edit HPA thresholds
kubectl edit hpa discord-audio-hpa -n discord-bot
```

### Cluster Auto-Scaling

For cloud providers (GKE, EKS, AKS):

**GKE**:
```bash
gcloud container clusters update <cluster-name> \
  --enable-autoscaling \
  --min-nodes=3 \
  --max-nodes=10 \
  --zone=<zone>
```

**EKS**:
```bash
# Configure via eksctl or cluster autoscaler
eksctl create cluster --managed --asg-access
```

---

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n discord-bot

# Describe pod for events
kubectl describe pod <pod-name> -n discord-bot

# Check logs
kubectl logs <pod-name> -n discord-bot

# Common issues:
# 1. ImagePullBackOff: Image not available
# 2. CrashLoopBackOff: Application crashing on startup
# 3. Pending: Insufficient resources or PVC issues
```

### Database Connection Issues

```bash
# Test PostgreSQL connection
kubectl exec -it postgres-0 -n discord-bot -- psql -U postgres -c "SELECT 1;"

# Test from application pod
kubectl exec -it <app-pod> -n discord-bot -- nc -zv postgres 5432

# Check PostgreSQL logs
kubectl logs postgres-0 -n discord-bot

# Check network policies
kubectl describe networkpolicy postgres-netpol -n discord-bot
```

### Redis Connection Issues

```bash
# Test Redis connection
kubectl exec -it redis-0 -n discord-bot -- redis-cli ping

# Test from application pod
kubectl exec -it <app-pod> -n discord-bot -- nc -zv redis 6379

# Check Redis logs
kubectl logs redis-0 -n discord-bot
```

### Lavalink Connection Issues

```bash
# Check Lavalink health
kubectl exec -it <lavalink-pod> -n discord-bot -- wget -qO- http://localhost:2333/version

# Check Lavalink logs
kubectl logs -f <lavalink-pod> -n discord-bot

# Test from audio service
kubectl exec -it <audio-pod> -n discord-bot -- nc -zv lavalink 2333
```

### HPA Not Scaling

```bash
# Check metrics server
kubectl top nodes
kubectl top pods -n discord-bot

# Check HPA status
kubectl describe hpa discord-audio-hpa -n discord-bot

# Check HPA conditions
kubectl get hpa discord-audio-hpa -n discord-bot -o yaml
```

### Network Policy Issues

```bash
# List network policies
kubectl get networkpolicy -n discord-bot

# Describe policy
kubectl describe networkpolicy <policy-name> -n discord-bot

# Test connectivity
kubectl run test-pod --rm -it --image=busybox -n discord-bot -- nc -zv postgres 5432

# Temporarily disable policy for debugging
kubectl delete networkpolicy <policy-name> -n discord-bot  # Re-apply after testing
```

---

## Maintenance

### Updates and Rollouts

```bash
# Update deployment image
kubectl set image deployment/discord-gateway gateway=discord-bot/gateway:v2.0 -n discord-bot

# Check rollout status
kubectl rollout status deployment/discord-gateway -n discord-bot

# Rollout history
kubectl rollout history deployment/discord-gateway -n discord-bot

# Rollback to previous version
kubectl rollout undo deployment/discord-gateway -n discord-bot

# Rollback to specific revision
kubectl rollout undo deployment/discord-gateway --to-revision=2 -n discord-bot
```

### Backup and Restore

**PostgreSQL Backup**:

```bash
# Create backup
kubectl exec postgres-0 -n discord-bot -- pg_dump -U postgres discord > backup.sql

# Restore backup
kubectl exec -i postgres-0 -n discord-bot -- psql -U postgres discord < backup.sql
```

**Redis Backup**:

```bash
# Trigger manual save
kubectl exec redis-0 -n discord-bot -- redis-cli SAVE

# Copy RDB file
kubectl cp discord-bot/redis-0:/data/dump.rdb ./dump.rdb

# Restore: Copy file back and restart
kubectl cp ./dump.rdb discord-bot/redis-0:/data/dump.rdb
kubectl delete pod redis-0 -n discord-bot  # Will restart with new data
```

### Node Maintenance

```bash
# Drain node for maintenance (respects PDBs)
kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data

# Uncordon node after maintenance
kubectl uncordon <node-name>
```

### Cleanup

```bash
# Delete all resources in namespace
kubectl delete namespace discord-bot

# Delete specific resources
kubectl delete -f k8s/

# Delete specific deployment
kubectl delete deployment discord-gateway -n discord-bot
```

---

## Production Checklist

Before going to production, ensure:

- [ ] Secrets are created from secure vault (not example file)
- [ ] TLS certificates are configured (cert-manager or manual)
- [ ] Domain DNS is configured and pointing to ingress
- [ ] Resource limits are set appropriately for workload
- [ ] HPA is configured and metrics server is running
- [ ] PodDisruptionBudgets are applied
- [ ] NetworkPolicies are applied and tested
- [ ] Monitoring is configured (Prometheus, Grafana)
- [ ] Backup strategy is implemented for databases
- [ ] Disaster recovery plan is documented
- [ ] Logs are aggregated (ELK, Loki, CloudWatch)
- [ ] Alerts are configured for critical metrics
- [ ] Cluster autoscaling is enabled (if on cloud)
- [ ] Multi-zone deployment for HA (if on cloud)
- [ ] Security scanning is integrated (Snyk, Trivy)
- [ ] Tested failover scenarios
- [ ] Documented runbooks for common issues

---

## Next Steps

1. **Phase 2**: Implement comprehensive testing (E2E, load, integration)
2. **Phase 3**: Create architecture diagrams and API documentation
3. **Phase 4**: Set up monitoring dashboards and alerts
4. **Phase 5**: Implement performance optimizations
5. **Phase 6**: Final verification and certification

See [COMPLETE_IMPLEMENTATION_GUIDE.md](../COMPLETE_IMPLEMENTATION_GUIDE.md) for the full roadmap.

---

**Questions or issues?** Check the troubleshooting section or file an issue on GitHub.
