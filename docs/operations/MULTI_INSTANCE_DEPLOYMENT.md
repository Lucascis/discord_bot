# 🚀 Multi-Instance Deployment Guide

## Overview

This guide covers deploying Discord Music Bot across multiple instances for high availability, load distribution, and geographic redundancy. Suitable for Enterprise customers and large-scale deployments.

---

## 📋 Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Infrastructure Setup](#infrastructure-setup)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Redis Cluster Configuration](#redis-cluster-configuration)
- [Database Clustering](#database-clustering)
- [Load Balancing](#load-balancing)
- [Monitoring & Observability](#monitoring--observability)
- [Disaster Recovery](#disaster-recovery)
- [Scaling Strategies](#scaling-strategies)
- [Cost Optimization](#cost-optimization)

---

## 🏗️ Architecture Overview

### Multi-Instance Architecture

```
                         ┌─────────────────┐
                         │  Load Balancer  │
                         │   (HAProxy/     │
                         │    Nginx)       │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
        ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
        │  Gateway  │      │  Gateway  │      │  Gateway  │
        │ Instance 1│      │ Instance 2│      │ Instance 3│
        └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                         ┌────────▼────────┐
                         │  Redis Cluster  │
                         │   (Pub/Sub +    │
                         │    Cache)       │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
        ┌─────▼─────┐      ┌─────▼─────┐      ┌─────▼─────┐
        │   Audio   │      │   Audio   │      │   Audio   │
        │ Instance 1│      │ Instance 2│      │ Instance 3│
        └─────┬─────┘      └─────┬─────┘      └─────┬─────┘
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
             ┌──────▼──────┐           ┌───────▼───────┐
             │  PostgreSQL │           │   Lavalink    │
             │   Cluster   │           │   Cluster     │
             │ (Primary +  │           │ (Multiple     │
             │  Replicas)  │           │  Instances)   │
             └─────────────┘           └───────────────┘
```

### Service Distribution Strategy

**Gateway Services:**
- Discord.js client instances
- WebSocket connections to Discord
- Command handling
- Interaction management
- Distribute based on Discord guilds

**Audio Services:**
- Lavalink integration
- Music playback logic
- Autoplay management
- Distribute based on active players

**API Services:**
- REST endpoints
- Stateless design
- Any instance can handle any request
- Round-robin load balancing

**Worker Services:**
- Background job processing
- Queue cleanup
- Analytics processing
- Distribute by job type

---

## 🔧 Prerequisites

### Infrastructure Requirements

**Minimum per Instance:**
- 4 vCPUs
- 8GB RAM
- 50GB SSD storage
- 1Gbps network

**Recommended for Production:**
- 8 vCPUs
- 16GB RAM
- 100GB NVMe SSD
- 10Gbps network

### Software Requirements

**Required:**
- Kubernetes 1.26+
- Docker 24.0+
- Helm 3.12+
- kubectl configured

**Recommended:**
- Istio 1.20+ (service mesh)
- Prometheus + Grafana (monitoring)
- ELK Stack (logging)
- Cert-manager (TLS)

### Cloud Provider Recommendations

**AWS:**
- EKS for Kubernetes
- RDS for PostgreSQL
- ElastiCache for Redis
- ALB for load balancing
- Route53 for DNS

**GCP:**
- GKE for Kubernetes
- Cloud SQL for PostgreSQL
- Memorystore for Redis
- Cloud Load Balancing
- Cloud DNS

**Azure:**
- AKS for Kubernetes
- Azure Database for PostgreSQL
- Azure Cache for Redis
- Application Gateway
- Azure DNS

---

## 🌐 Infrastructure Setup

### 1. Kubernetes Cluster Creation

**AWS (EKS):**
```bash
# Create EKS cluster
eksctl create cluster \
  --name discord-bot-prod \
  --version 1.28 \
  --region us-east-1 \
  --nodegroup-name standard-workers \
  --node-type t3.xlarge \
  --nodes 6 \
  --nodes-min 3 \
  --nodes-max 12 \
  --managed \
  --node-volume-size 100

# Configure kubectl
aws eks update-kubeconfig --region us-east-1 --name discord-bot-prod
```

**GCP (GKE):**
```bash
# Create GKE cluster
gcloud container clusters create discord-bot-prod \
  --region us-central1 \
  --machine-type n1-standard-4 \
  --num-nodes 2 \
  --min-nodes 3 \
  --max-nodes 12 \
  --enable-autoscaling \
  --enable-autorepair \
  --enable-autoupgrade \
  --disk-size 100

# Get credentials
gcloud container clusters get-credentials discord-bot-prod --region us-central1
```

**Azure (AKS):**
```bash
# Create resource group
az group create --name discord-bot-rg --location eastus

# Create AKS cluster
az aks create \
  --resource-group discord-bot-rg \
  --name discord-bot-prod \
  --node-count 6 \
  --node-vm-size Standard_D4s_v3 \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 12 \
  --node-osdisk-size 100 \
  --generate-ssh-keys

# Get credentials
az aks get-credentials --resource-group discord-bot-rg --name discord-bot-prod
```

### 2. Namespace Setup

```bash
# Create namespaces
kubectl create namespace discord-bot-prod
kubectl create namespace discord-bot-monitoring
kubectl create namespace discord-bot-redis
kubectl create namespace discord-bot-database

# Set default namespace
kubectl config set-context --current --namespace=discord-bot-prod

# Label namespaces
kubectl label namespace discord-bot-prod environment=production
kubectl label namespace discord-bot-prod app=discord-music-bot
```

### 3. Storage Classes

```yaml
# storage-class.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: kubernetes.io/aws-ebs  # or gce-pd, azure-disk
parameters:
  type: gp3
  iopsPerGB: "50"
  fsType: ext4
volumeBindingMode: WaitForFirstConsumer
allowVolumeExpansion: true
reclaimPolicy: Retain
```

```bash
kubectl apply -f storage-class.yaml
```

---

## ⚙️ Kubernetes Deployment

### 1. ConfigMaps and Secrets

```yaml
# config/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: discord-bot-config
  namespace: discord-bot-prod
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"

  # Redis Configuration
  REDIS_CLUSTER_MODE: "true"
  REDIS_CLUSTER_NODES: "redis-0.redis-headless:6379,redis-1.redis-headless:6379,redis-2.redis-headless:6379"

  # Database Configuration
  DATABASE_POOL_SIZE: "20"
  DATABASE_SSL_MODE: "require"

  # Lavalink Configuration
  LAVALINK_NODES: "lavalink-0.lavalink:2333,lavalink-1.lavalink:2333,lavalink-2.lavalink:2333"

  # Service Configuration
  GATEWAY_HTTP_PORT: "3001"
  AUDIO_HTTP_PORT: "3002"
  API_HTTP_PORT: "3000"
  WORKER_HTTP_PORT: "3003"

  # Feature Flags
  PREMIUM_FEATURES_ENABLED: "true"
  SENTRY_ENABLED: "true"
```

```yaml
# config/secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: discord-bot-secrets
  namespace: discord-bot-prod
type: Opaque
stringData:
  DISCORD_TOKEN: "your-discord-bot-token"
  DISCORD_APPLICATION_ID: "your-application-id"
  DATABASE_URL: "postgresql://user:pass@postgres-primary:5432/discordbot"
  REDIS_PASSWORD: "your-redis-password"
  LAVALINK_PASSWORD: "your-lavalink-password"
  SENTRY_DSN: "your-sentry-dsn"
  SPOTIFY_CLIENT_ID: "your-spotify-client-id"
  SPOTIFY_CLIENT_SECRET: "your-spotify-client-secret"
```

```bash
# Apply configurations
kubectl apply -f config/configmap.yaml
kubectl apply -f config/secrets.yaml
```

### 2. Gateway Service Deployment

```yaml
# deployments/gateway.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  namespace: discord-bot-prod
  labels:
    app: discord-bot
    component: gateway
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: discord-bot
      component: gateway
  template:
    metadata:
      labels:
        app: discord-bot
        component: gateway
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3001"
        prometheus.io/path: "/metrics"
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: component
                  operator: In
                  values:
                  - gateway
              topologyKey: kubernetes.io/hostname
      containers:
      - name: gateway
        image: ghcr.io/your-org/discord-bot-gateway:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 3001
          protocol: TCP
        env:
        - name: NODE_ENV
          valueFrom:
            configMapKeyRef:
              name: discord-bot-config
              key: NODE_ENV
        - name: DISCORD_TOKEN
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: DISCORD_TOKEN
        - name: DISCORD_APPLICATION_ID
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: DISCORD_APPLICATION_ID
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: DATABASE_URL
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: REDIS_PASSWORD
        envFrom:
        - configMapRef:
            name: discord-bot-config
        resources:
          requests:
            cpu: "1000m"
            memory: "2Gi"
          limits:
            cpu: "2000m"
            memory: "4Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 3001
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 2
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
  namespace: discord-bot-prod
  labels:
    app: discord-bot
    component: gateway
spec:
  type: ClusterIP
  ports:
  - port: 3001
    targetPort: 3001
    protocol: TCP
    name: http
  selector:
    app: discord-bot
    component: gateway
```

### 3. Audio Service Deployment

```yaml
# deployments/audio.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: audio
  namespace: discord-bot-prod
  labels:
    app: discord-bot
    component: audio
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: discord-bot
      component: audio
  template:
    metadata:
      labels:
        app: discord-bot
        component: audio
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3002"
        prometheus.io/path: "/metrics"
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: component
                  operator: In
                  values:
                  - audio
              topologyKey: kubernetes.io/hostname
      containers:
      - name: audio
        image: ghcr.io/your-org/discord-bot-audio:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 3002
          protocol: TCP
        env:
        - name: LAVALINK_PASSWORD
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: LAVALINK_PASSWORD
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: DATABASE_URL
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: REDIS_PASSWORD
        envFrom:
        - configMapRef:
            name: discord-bot-config
        resources:
          requests:
            cpu: "1000m"
            memory: "2Gi"
          limits:
            cpu: "2000m"
            memory: "4Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3002
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3002
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: audio
  namespace: discord-bot-prod
  labels:
    app: discord-bot
    component: audio
spec:
  type: ClusterIP
  ports:
  - port: 3002
    targetPort: 3002
    protocol: TCP
    name: http
  selector:
    app: discord-bot
    component: audio
```

### 4. API Service Deployment

```yaml
# deployments/api.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: discord-bot-prod
  labels:
    app: discord-bot
    component: api
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 2
      maxUnavailable: 0
  selector:
    matchLabels:
      app: discord-bot
      component: api
  template:
    metadata:
      labels:
        app: discord-bot
        component: api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
      - name: api
        image: ghcr.io/your-org/discord-bot-api:latest
        imagePullPolicy: Always
        ports:
        - name: http
          containerPort: 3000
          protocol: TCP
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: DATABASE_URL
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: discord-bot-secrets
              key: REDIS_PASSWORD
        envFrom:
        - configMapRef:
            name: discord-bot-config
        resources:
          requests:
            cpu: "500m"
            memory: "1Gi"
          limits:
            cpu: "1000m"
            memory: "2Gi"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 15
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: discord-bot-prod
  labels:
    app: discord-bot
    component: api
spec:
  type: ClusterIP
  ports:
  - port: 3000
    targetPort: 3000
    protocol: TCP
    name: http
  selector:
    app: discord-bot
    component: api
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api-ingress
  namespace: discord-bot-prod
  annotations:
    kubernetes.io/ingress.class: "nginx"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/rate-limit: "100"
spec:
  tls:
  - hosts:
    - api.discordmusicbot.com
    secretName: api-tls
  rules:
  - host: api.discordmusicbot.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api
            port:
              number: 3000
```

### 5. Horizontal Pod Autoscaling

```yaml
# autoscaling/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: gateway-hpa
  namespace: discord-bot-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: gateway
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: audio-hpa
  namespace: discord-bot-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: audio
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
  namespace: discord-bot-prod
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 8
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60
```

---

## 🔴 Redis Cluster Configuration

### Using Redis Cluster with Kubernetes

```yaml
# redis/redis-cluster.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: redis-cluster-config
  namespace: discord-bot-redis
data:
  redis.conf: |
    cluster-enabled yes
    cluster-config-file /data/nodes.conf
    cluster-node-timeout 5000
    appendonly yes
    protected-mode no
    bind 0.0.0.0
    port 6379
    maxmemory 2gb
    maxmemory-policy allkeys-lru
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis-cluster
  namespace: discord-bot-redis
spec:
  serviceName: redis-cluster
  replicas: 6
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
        ports:
        - containerPort: 6379
          name: client
        - containerPort: 16379
          name: gossip
        command:
        - redis-server
        args:
        - /conf/redis.conf
        volumeMounts:
        - name: conf
          mountPath: /conf
        - name: data
          mountPath: /data
        resources:
          requests:
            cpu: "500m"
            memory: "2Gi"
          limits:
            cpu: "1000m"
            memory: "4Gi"
      volumes:
      - name: conf
        configMap:
          name: redis-cluster-config
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 20Gi
---
apiVersion: v1
kind: Service
metadata:
  name: redis-cluster
  namespace: discord-bot-redis
spec:
  type: ClusterIP
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

### Initialize Redis Cluster

```bash
# Wait for all pods to be ready
kubectl wait --for=condition=ready pod -l app=redis-cluster -n discord-bot-redis --timeout=300s

# Get pod IPs
POD_IPS=$(kubectl get pods -l app=redis-cluster -n discord-bot-redis -o jsonpath='{range.items[*]}{.status.podIP}:6379 {end}')

# Create cluster
kubectl exec -it redis-cluster-0 -n discord-bot-redis -- redis-cli --cluster create $POD_IPS --cluster-replicas 1 --cluster-yes

# Verify cluster
kubectl exec -it redis-cluster-0 -n discord-bot-redis -- redis-cli cluster info
```

---

## 🗄️ Database Clustering

### PostgreSQL High Availability with Patroni

```yaml
# database/postgres-ha.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-config
  namespace: discord-bot-database
data:
  PATRONI_SCOPE: "discord-bot"
  PATRONI_NAMESPACE: "discord-bot-database"
  PATRONI_NAME: "postgres"
  PGDATA: "/var/lib/postgresql/data/pgdata"
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: discord-bot-database
spec:
  serviceName: postgres
  replicas: 3
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_USER
          value: "discordbot"
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-secrets
              key: password
        - name: POSTGRES_DB
          value: "discordbot"
        - name: PGDATA
          value: "/var/lib/postgresql/data/pgdata"
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            cpu: "1000m"
            memory: "4Gi"
          limits:
            cpu: "2000m"
            memory: "8Gi"
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U discordbot
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U discordbot
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: fast-ssd
      resources:
        requests:
          storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-primary
  namespace: discord-bot-database
  labels:
    app: postgres
    role: primary
spec:
  type: ClusterIP
  ports:
  - port: 5432
    targetPort: 5432
  selector:
    app: postgres
    role: primary
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-replica
  namespace: discord-bot-database
  labels:
    app: postgres
    role: replica
spec:
  type: ClusterIP
  ports:
  - port: 5432
    targetPort: 5432
  selector:
    app: postgres
    role: replica
```

### Database Connection Pooling with PgBouncer

```yaml
# database/pgbouncer.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: pgbouncer-config
  namespace: discord-bot-database
data:
  pgbouncer.ini: |
    [databases]
    discordbot = host=postgres-primary port=5432 dbname=discordbot

    [pgbouncer]
    listen_addr = *
    listen_port = 6432
    auth_type = md5
    auth_file = /etc/pgbouncer/userlist.txt
    pool_mode = transaction
    max_client_conn = 1000
    default_pool_size = 25
    reserve_pool_size = 5
    reserve_pool_timeout = 3
    server_lifetime = 3600
    server_idle_timeout = 600
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pgbouncer
  namespace: discord-bot-database
spec:
  replicas: 2
  selector:
    matchLabels:
      app: pgbouncer
  template:
    metadata:
      labels:
        app: pgbouncer
    spec:
      containers:
      - name: pgbouncer
        image: edoburu/pgbouncer:latest
        ports:
        - containerPort: 6432
        volumeMounts:
        - name: config
          mountPath: /etc/pgbouncer
        resources:
          requests:
            cpu: "200m"
            memory: "256Mi"
          limits:
            cpu: "500m"
            memory: "512Mi"
      volumes:
      - name: config
        configMap:
          name: pgbouncer-config
---
apiVersion: v1
kind: Service
metadata:
  name: pgbouncer
  namespace: discord-bot-database
spec:
  type: ClusterIP
  ports:
  - port: 6432
    targetPort: 6432
  selector:
    app: pgbouncer
```

---

## ⚖️ Load Balancing

### Nginx Ingress Controller

```bash
# Install Nginx Ingress Controller
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.replicaCount=3 \
  --set controller.nodeSelector."kubernetes\.io/os"=linux \
  --set controller.service.externalTrafficPolicy=Local \
  --set controller.metrics.enabled=true \
  --set controller.metrics.serviceMonitor.enabled=true
```

### HAProxy Configuration (Alternative)

```yaml
# haproxy/haproxy-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: haproxy-config
  namespace: discord-bot-prod
data:
  haproxy.cfg: |
    global
      maxconn 4096
      daemon

    defaults
      mode http
      timeout connect 5000ms
      timeout client 50000ms
      timeout server 50000ms

    frontend api_frontend
      bind *:80
      bind *:443 ssl crt /etc/ssl/certs/cert.pem
      default_backend api_backend

    backend api_backend
      balance roundrobin
      option httpchk GET /health
      server api1 api-0.api:3000 check
      server api2 api-1.api:3000 check
      server api3 api-2.api:3000 check
```

---

## 📊 Monitoring & Observability

### Prometheus & Grafana Setup

```bash
# Add Prometheus helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Install Prometheus
helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace discord-bot-monitoring \
  --set prometheus.prometheusSpec.retention=30d \
  --set prometheus.prometheusSpec.storageSpec.volumeClaimTemplate.spec.resources.requests.storage=100Gi \
  --set grafana.enabled=true \
  --set grafana.adminPassword=admin

# Get Grafana password
kubectl get secret --namespace discord-bot-monitoring prometheus-grafana -o jsonpath="{.data.admin-password}" | base64 --decode

# Port forward Grafana
kubectl port-forward --namespace discord-bot-monitoring svc/prometheus-grafana 3300:80
```

### ServiceMonitor for Bot Services

```yaml
# monitoring/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: discord-bot-metrics
  namespace: discord-bot-prod
  labels:
    app: discord-bot
spec:
  selector:
    matchLabels:
      app: discord-bot
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

### Custom Grafana Dashboard

```json
{
  "dashboard": {
    "title": "Discord Music Bot - Multi-Instance",
    "panels": [
      {
        "title": "Active Instances",
        "targets": [{
          "expr": "count(up{job=\"discord-bot-gateway\"})"
        }]
      },
      {
        "title": "Request Rate",
        "targets": [{
          "expr": "rate(http_requests_total[5m])"
        }]
      },
      {
        "title": "Error Rate",
        "targets": [{
          "expr": "rate(http_requests_total{status=~\"5..\"}[5m])"
        }]
      },
      {
        "title": "Memory Usage",
        "targets": [{
          "expr": "process_resident_memory_bytes"
        }]
      }
    ]
  }
}
```

---

## 🔄 Disaster Recovery

### Backup Strategy

```yaml
# backup/cronjob-backup.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: discord-bot-database
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: postgres-backup
            image: postgres:15-alpine
            command:
            - /bin/sh
            - -c
            - |
              pg_dump -h postgres-primary -U discordbot discordbot | \
              gzip > /backup/discordbot-$(date +%Y%m%d-%H%M%S).sql.gz

              # Upload to S3
              aws s3 cp /backup/*.sql.gz s3://discord-bot-backups/postgres/

              # Clean up local files older than 7 days
              find /backup -name "*.sql.gz" -mtime +7 -delete
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-secrets
                  key: password
            volumeMounts:
            - name: backup
              mountPath: /backup
          volumes:
          - name: backup
            persistentVolumeClaim:
              claimName: postgres-backup-pvc
          restartPolicy: OnFailure
```

### Restore Procedure

```bash
# Download latest backup
aws s3 cp s3://discord-bot-backups/postgres/latest.sql.gz ./

# Restore to database
gunzip -c latest.sql.gz | kubectl exec -i postgres-0 -n discord-bot-database -- psql -U discordbot discordbot

# Verify restoration
kubectl exec -it postgres-0 -n discord-bot-database -- psql -U discordbot discordbot -c "SELECT COUNT(*) FROM queue_items;"
```

---

## 📈 Scaling Strategies

### Vertical Scaling (Scale Up)

```bash
# Increase resources for gateway pods
kubectl patch deployment gateway -n discord-bot-prod -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "gateway",
          "resources": {
            "requests": {"cpu": "2000m", "memory": "4Gi"},
            "limits": {"cpu": "4000m", "memory": "8Gi"}
          }
        }]
      }
    }
  }
}'
```

### Horizontal Scaling (Scale Out)

```bash
# Manual scaling
kubectl scale deployment gateway --replicas=6 -n discord-bot-prod
kubectl scale deployment audio --replicas=6 -n discord-bot-prod
kubectl scale deployment api --replicas=4 -n discord-bot-prod

# Auto-scaling already configured via HPA
```

### Geographic Scaling (Multi-Region)

```bash
# Deploy to additional regions
kubectl config use-context us-west-2

# Apply same deployments
kubectl apply -f k8s/deployments/ -n discord-bot-prod

# Configure DNS for geographic routing
# Use Route53, Cloud DNS, or Azure Traffic Manager
```

---

## 💰 Cost Optimization

### Resource Right-Sizing

```bash
# Analyze resource usage
kubectl top pods -n discord-bot-prod
kubectl top nodes

# Identify over-provisioned pods
kubectl get pods -n discord-bot-prod -o custom-columns=NAME:.metadata.name,CPU_REQ:.spec.containers[*].resources.requests.cpu,CPU_LIM:.spec.containers[*].resources.limits.cpu,MEM_REQ:.spec.containers[*].resources.requests.memory,MEM_LIM:.spec.containers[*].resources.limits.memory
```

### Spot/Preemptible Instances

**AWS:**
```bash
# Create spot instance node group
eksctl create nodegroup \
  --cluster discord-bot-prod \
  --region us-east-1 \
  --name spot-workers \
  --node-type t3.large \
  --nodes 3 \
  --nodes-min 2 \
  --nodes-max 8 \
  --spot \
  --instance-types t3.large,t3a.large
```

**GCP:**
```bash
# Create preemptible node pool
gcloud container node-pools create spot-pool \
  --cluster discord-bot-prod \
  --preemptible \
  --machine-type n1-standard-2 \
  --num-nodes 3 \
  --min-nodes 2 \
  --max-nodes 8
```

### Pod Disruption Budgets

```yaml
# pdb/gateway-pdb.yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: gateway-pdb
  namespace: discord-bot-prod
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: discord-bot
      component: gateway
```

---

## ✅ Deployment Checklist

### Pre-Deployment

- [ ] Kubernetes cluster provisioned
- [ ] Namespaces created
- [ ] ConfigMaps configured
- [ ] Secrets created (encrypted)
- [ ] Storage classes defined
- [ ] Network policies applied
- [ ] RBAC configured
- [ ] Ingress controller installed
- [ ] Certificate manager setup
- [ ] Monitoring stack deployed

### Deployment

- [ ] Redis cluster deployed and initialized
- [ ] PostgreSQL cluster deployed
- [ ] PgBouncer deployed
- [ ] Lavalink instances deployed
- [ ] Gateway service deployed
- [ ] Audio service deployed
- [ ] API service deployed
- [ ] Worker service deployed
- [ ] HPAs configured
- [ ] Pod disruption budgets set

### Post-Deployment

- [ ] Health checks passing
- [ ] Metrics collecting
- [ ] Logs aggregating
- [ ] Alerts configured
- [ ] Backups running
- [ ] Load testing performed
- [ ] Disaster recovery tested
- [ ] Documentation updated
- [ ] Team trained
- [ ] Monitoring dashboards created

---

## 🔗 Additional Resources

- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [Prometheus Monitoring](https://prometheus.io/docs/introduction/overview/)
- [Redis Cluster Tutorial](https://redis.io/docs/management/scaling/)
- [PostgreSQL High Availability](https://www.postgresql.org/docs/current/high-availability.html)

---

**Last Updated:** October 31, 2025

*This guide assumes familiarity with Kubernetes, Docker, and cloud infrastructure. For assistance with deployment, contact enterprise@discordmusicbot.com*
