# Security Documentation

**Last Updated:** October 31, 2025
**Version:** 1.0.0
**Classification:** Internal - Operations Guide

## Table of Contents

1. [Security Overview](#security-overview)
2. [Secrets Management](#secrets-management)
3. [Authentication & Authorization](#authentication--authorization)
4. [Network Security](#network-security)
5. [Database Security](#database-security)
6. [Container Security](#container-security)
7. [Monitoring & Auditing](#monitoring--auditing)
8. [Security Best Practices](#security-best-practices)
9. [Compliance & Privacy](#compliance--privacy)
10. [Security Audit Checklist](#security-audit-checklist)
11. [Vulnerability Reporting](#vulnerability-reporting)
12. [Security Resources](#security-resources)

---

## Security Overview

### Security Architecture

The Discord bot implements a defense-in-depth security strategy across four layers:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Network Security (Firewall, TLS, Rate Limits) │
├─────────────────────────────────────────────────────────┤
│  Layer 2: Application Security (Auth, Input Validation) │
├─────────────────────────────────────────────────────────┤
│  Layer 3: Data Security (Encryption, Access Control)    │
├─────────────────────────────────────────────────────────┤
│  Layer 4: Infrastructure Security (Docker, Monitoring)  │
└─────────────────────────────────────────────────────────┘
```

### Security Principles

1. **Least Privilege** - Services run with minimal required permissions
2. **Defense in Depth** - Multiple layers of security controls
3. **Fail Securely** - System defaults to secure state on error
4. **Separation of Concerns** - Services isolated via Docker networks
5. **Audit Everything** - Comprehensive logging and monitoring

### Service Security Model

| Service | Authentication | Network Exposure | Risk Level |
|---------|---------------|------------------|------------|
| Gateway | Discord Token | Internal Only | High |
| Audio | Lavalink Password | Internal Only | Medium |
| API | API Key + Rate Limit | Public (Optional) | Medium |
| Worker | None (Internal) | Internal Only | Low |
| PostgreSQL | Password Auth | Internal Only | Critical |
| Redis | No Auth (Network Isolation) | Internal Only | High |
| Lavalink | Password Auth | Internal Only | Medium |

---

## Secrets Management

### Environment Variable Protection

All sensitive data is managed through environment variables and **NEVER** committed to version control.

#### Critical Secrets

```bash
# .env (NEVER commit this file)

# Discord Credentials (CRITICAL - Full Bot Access)
DISCORD_TOKEN=your-bot-token                    # Risk: Complete bot compromise
DISCORD_APPLICATION_ID=your-application-id      # Risk: Command injection

# Database Credentials (CRITICAL - Data Access)
DATABASE_URL=postgresql://user:password@host:5432/db  # Risk: Complete data breach

# API Security (HIGH - External Access)
API_KEY=your-secure-random-api-key              # Risk: Unauthorized API access
WEBHOOK_SECRET=your-webhook-signature-secret    # Risk: Webhook forgery

# Service Credentials (MEDIUM - Service Access)
LAVALINK_PASSWORD=your-lavalink-password        # Risk: Audio service hijacking
REDIS_URL=redis://redis:6379                    # Risk: Message interception

# External API Keys (MEDIUM - Feature Access)
SPOTIFY_CLIENT_ID=your-spotify-client-id
SPOTIFY_CLIENT_SECRET=your-spotify-client-secret
YOUTUBE_PO_TOKEN=your-youtube-po-token          # Risk: Account suspension

# Monitoring (LOW - Observability)
SENTRY_DSN=https://key@sentry.io/project        # Risk: Error log exposure
```

### .gitignore Configuration

Verify `.gitignore` protects sensitive files:

```bash
# Check that .env is gitignored
grep -E "^\.env$|^\.env\.\*$" .gitignore

# Verify no secrets are tracked
git ls-files | grep -E "\.env$|credentials|secrets|keys"
```

**Expected output:** Only `.env.example` should appear, not `.env`.

### Docker Secrets vs Environment Variables

#### Using Environment Variables (Current Method)

```yaml
# docker-compose.yml
services:
  gateway:
    env_file: .env  # Simple but exposes secrets in container inspect
```

#### Using Docker Secrets (Recommended for Production)

```yaml
# docker-compose.yml
services:
  gateway:
    secrets:
      - discord_token
      - database_url
    environment:
      DISCORD_TOKEN_FILE: /run/secrets/discord_token
      DATABASE_URL_FILE: /run/secrets/database_url

secrets:
  discord_token:
    file: ./secrets/discord_token.txt
  database_url:
    file: ./secrets/database_url.txt
```

**Setup Docker Secrets:**

```bash
# Create secrets directory (gitignored)
mkdir -p secrets
chmod 700 secrets

# Create individual secret files
echo "your-discord-token" > secrets/discord_token.txt
echo "postgresql://user:pass@postgres:5432/db" > secrets/database_url.txt

# Secure permissions
chmod 600 secrets/*.txt

# Update .gitignore
echo "secrets/" >> .gitignore
```

**Modify application to read from files:**

```typescript
// packages/config/src/env.ts
function readSecret(envVar: string): string {
  const fileVar = `${envVar}_FILE`;
  const filePath = process.env[fileVar];

  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8').trim();
  }

  return process.env[envVar] || '';
}

export const env = {
  DISCORD_TOKEN: readSecret('DISCORD_TOKEN'),
  DATABASE_URL: readSecret('DATABASE_URL'),
  // ... rest of config
};
```

### Key Rotation Procedures

#### Discord Token Rotation

```bash
# 1. Generate new token at https://discord.com/developers/applications
# 2. Test with new token in staging
DISCORD_TOKEN=new-token pnpm dev:gateway

# 3. Update production .env
nano .env  # or use secrets management

# 4. Rolling restart services
docker-compose restart gateway

# 5. Verify health
curl http://localhost:3001/health

# 6. Revoke old token in Discord Developer Portal
```

#### API Key Rotation

```bash
# 1. Generate new API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 2. Update .env with new key
API_KEY=new-key-here

# 3. Notify API consumers of upcoming rotation (7-day notice)

# 4. Deploy with grace period (accept both old and new keys)
# Modify api/src/app.ts to accept array of keys

# 5. After grace period, remove old key
docker-compose restart api

# 6. Verify API endpoints
curl -H "X-API-Key: new-key" http://localhost:3000/api/v1/guilds
```

#### Database Password Rotation

```bash
# 1. Connect to PostgreSQL container
docker exec -it discord-postgres psql -U postgres

# 2. Create new user with same permissions
CREATE USER postgres_new WITH PASSWORD 'new-secure-password';
GRANT ALL PRIVILEGES ON DATABASE discord TO postgres_new;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres_new;

# 3. Update DATABASE_URL in .env
DATABASE_URL=postgresql://postgres_new:new-secure-password@postgres:5432/discord

# 4. Restart all services
docker-compose restart

# 5. Verify database connectivity
docker-compose logs gateway | grep "Database connection"

# 6. Drop old user
DROP USER postgres;
ALTER USER postgres_new RENAME TO postgres;
```

### Encryption at Rest

#### Database Encryption

Enable PostgreSQL encryption for sensitive columns:

```sql
-- Install pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Encrypt sensitive data
CREATE TABLE user_preferences (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  encrypted_data BYTEA,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert encrypted data
INSERT INTO user_preferences (user_id, encrypted_data)
VALUES (
  '123456789',
  pgp_sym_encrypt('sensitive_data', 'encryption_key')
);

-- Query encrypted data
SELECT user_id, pgp_sym_decrypt(encrypted_data, 'encryption_key') AS data
FROM user_preferences;
```

#### Volume Encryption (Linux)

```bash
# Enable LUKS encryption for Docker volumes
sudo cryptsetup luksFormat /dev/sdb1
sudo cryptsetup open /dev/sdb1 encrypted_volume
sudo mkfs.ext4 /dev/mapper/encrypted_volume

# Mount encrypted volume
sudo mount /dev/mapper/encrypted_volume /var/lib/docker/volumes

# Update docker-compose.yml to use encrypted volume path
```

#### File-Level Encryption

```bash
# Encrypt sensitive log files
openssl enc -aes-256-cbc -salt -in logs/audit.log -out logs/audit.log.enc
rm logs/audit.log

# Decrypt when needed
openssl enc -d -aes-256-cbc -in logs/audit.log.enc -out logs/audit.log
```

---

## Authentication & Authorization

### Discord Token Security

#### Token Acquisition

1. Visit https://discord.com/developers/applications
2. Create application → Bot → Copy Token
3. **NEVER** share or commit this token
4. Enable "Message Content Intent" for bot functionality

#### Token Storage Best Practices

```bash
# Generate secure .env file
cat > .env << 'EOF'
DISCORD_TOKEN=your-token-here
# Add other vars...
EOF

# Secure file permissions (Unix/Linux/macOS)
chmod 600 .env

# Secure file permissions (Windows PowerShell)
icacls .env /inheritance:r /grant:r "$($env:USERNAME):(R,W)"
```

#### Token Validation

```typescript
// gateway/src/index.ts - Token validation on startup
import { Client, GatewayIntentBits } from 'discord.js';
import { logger } from '@discord-bot/logger';

async function validateToken(token: string): Promise<boolean> {
  try {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(token);
    await client.destroy();
    return true;
  } catch (error) {
    logger.error({ error }, 'Invalid Discord token');
    return false;
  }
}

// On startup
if (!await validateToken(env.DISCORD_TOKEN)) {
  logger.fatal('Invalid Discord token - shutting down');
  process.exit(1);
}
```

### API Key Generation and Management

#### Generating Secure API Keys

```bash
# Method 1: OpenSSL (recommended)
openssl rand -hex 32

# Method 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Method 3: PowerShell (Windows)
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

# Output example: a1b2c3d4e5f6...
```

#### API Key Validation Schema

```typescript
// api/src/middleware/validation.ts
import { z } from 'zod';

export const apiKeySchema = z.string()
  .min(32, 'API key must be at least 32 characters')
  .max(128, 'API key must not exceed 128 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'API key contains invalid characters');
```

#### API Key Rate Limiting

Current implementation in `api/src/app.ts`:

```typescript
// Standard rate limit: 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 900000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP'
});

// Strict rate limit for sensitive endpoints: 20 requests per 15 minutes
const strictLimiter = rateLimit({
  windowMs: 900000,
  max: 20,
  message: 'Rate limit exceeded for sensitive operations'
});
```

### Webhook Signature Verification

#### HMAC-SHA256 Signature Verification

The bot implements webhook signature verification to prevent forgery:

```typescript
// api/src/routes/v1/webhooks.ts
import crypto from 'crypto';

function verifyWebhookSignature(req: Request): boolean {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  const secret = process.env.WEBHOOK_SECRET;

  // Verify timestamp (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  const webhookTime = parseInt(timestamp, 10);
  if (Math.abs(currentTime - webhookTime) > 300) {
    return false; // Reject requests older than 5 minutes
  }

  // Verify HMAC signature
  const body = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}
```

#### Webhook Client Implementation

```typescript
// Example webhook client
import crypto from 'crypto';
import axios from 'axios';

async function sendWebhook(payload: object) {
  const secret = 'your-webhook-secret';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  const response = await axios.post('http://localhost:3000/api/v1/webhooks/music/play', payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': signature,
      'X-Webhook-Timestamp': timestamp.toString()
    }
  });

  return response.data;
}
```

#### Testing Webhook Security

```bash
# Test webhook with invalid signature (should fail)
curl -X POST http://localhost:3000/api/v1/webhooks/music/play \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: invalid" \
  -H "X-Webhook-Timestamp: $(date +%s)" \
  -d '{"guildId":"123","query":"test","userId":"456"}'

# Expected response: 401 Unauthorized

# Test webhook with expired timestamp (should fail)
curl -X POST http://localhost:3000/api/v1/webhooks/music/play \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $(echo -n "old_timestamp.{}" | openssl dgst -sha256 -hmac "secret" | awk '{print $2}')" \
  -H "X-Webhook-Timestamp: 1000000000" \
  -d '{"guildId":"123","query":"test","userId":"456"}'

# Expected response: 401 Unauthorized (timestamp too old)
```

### OAuth Flow Documentation

While the bot doesn't currently implement OAuth, here's guidance for future implementation:

#### Discord OAuth2 Flow

```typescript
// Future implementation: api/src/routes/oauth.ts
import express from 'express';

const router = express.Router();

// Step 1: Redirect to Discord OAuth
router.get('/authorize', (req, res) => {
  const clientId = process.env.DISCORD_APPLICATION_ID;
  const redirectUri = encodeURIComponent('http://yourdomain.com/api/oauth/callback');
  const scope = 'identify guilds';

  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`;

  res.redirect(authUrl);
});

// Step 2: Handle OAuth callback
router.get('/callback', async (req, res) => {
  const code = req.query.code;

  // Exchange code for access token
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_APPLICATION_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code as string,
      redirect_uri: 'http://yourdomain.com/api/oauth/callback'
    })
  });

  const { access_token } = await tokenResponse.json();

  // Store access_token securely (encrypted in database)
  // ...

  res.redirect('/dashboard');
});

export default router;
```

### Role-Based Access Control (RBAC)

#### DJ Role Configuration

The bot implements role-based access for music commands:

```bash
# .env
DJ_ROLE_NAME=DJ  # Users with this role can control music playback
```

#### Role Permission Checking

```typescript
// gateway/src/middleware/permissions.ts
import { CommandInteraction, PermissionFlagsBits } from 'discord.js';

export function requireDJRole(interaction: CommandInteraction): boolean {
  const member = interaction.member;
  const djRoleName = process.env.DJ_ROLE_NAME || 'DJ';

  // Check if user has DJ role
  const hasRole = member.roles.cache.some(role => role.name === djRoleName);

  // Check if user has administrator permission
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);

  return hasRole || isAdmin;
}

// Usage in command
async execute(interaction: CommandInteraction) {
  if (!requireDJRole(interaction)) {
    return interaction.reply({
      content: `❌ You need the **${process.env.DJ_ROLE_NAME}** role to use this command.`,
      ephemeral: true
    });
  }

  // Execute command...
}
```

#### Permission Hierarchy

```
Administrator (Discord Admin) ──────────────┐
                                            │
DJ Role (Custom Role) ─────────────────────┤─► Full Music Control
                                            │
Server Moderator (Manage Messages) ────────┘

Regular User ──────────────────────────────────► View Queue, Request Songs
```

---

## Network Security

### Docker Network Isolation

#### Network Architecture

```yaml
# docker-compose.yml
networks:
  discord-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
```

**Isolation Strategy:**
- All services communicate via internal network `discord-network`
- External access only through explicitly exposed ports
- Database and Redis are NOT exposed to host by default

#### Network Segmentation

```
┌─────────────────────────────────────────────────┐
│  External Network (Internet)                     │
│  ┌───────────────────────────────────────────┐  │
│  │  API Service (Port 3000) ← Public Access  │  │
│  └───────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│  Internal Network (discord-network)              │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Gateway    │  │ Audio      │  │ Worker    │ │
│  │ (3001)     │  │ (3002)     │  │ (3003)    │ │
│  └────────────┘  └────────────┘  └───────────┘ │
│  ┌────────────┐  ┌────────────┐  ┌───────────┐ │
│  │ PostgreSQL │  │ Redis      │  │ Lavalink  │ │
│  │ (5432)     │  │ (6379)     │  │ (2333)    │ │
│  └────────────┘  └────────────┘  └───────────┘ │
└─────────────────────────────────────────────────┘
```

### Port Exposure Configuration

#### Current Port Exposure (Development)

```yaml
# docker-compose.yml - Development Configuration
services:
  postgres:
    ports:
      - "5432:5432"  # ⚠️ EXPOSED - For development debugging
  redis:
    ports:
      - "6379:6379"  # ⚠️ EXPOSED - For development debugging
  lavalink:
    ports:
      - "2333:2333"  # ⚠️ EXPOSED - For development debugging
  api:
    ports:
      - "3000:3000"  # ✅ INTENDED - Public API endpoint
```

#### Production Port Exposure (Recommended)

```yaml
# docker-compose.prod.yml - Production Configuration
services:
  postgres:
    # NO ports exposed - internal only
  redis:
    # NO ports exposed - internal only
  lavalink:
    # NO ports exposed - internal only
  api:
    ports:
      - "127.0.0.1:3000:3000"  # ✅ Localhost only (behind reverse proxy)
  gateway:
    # NO ports exposed - internal only
  audio:
    # NO ports exposed - internal only
  worker:
    # NO ports exposed - internal only
```

### Firewall Recommendations

#### iptables Configuration (Linux)

```bash
#!/bin/bash
# firewall-setup.sh - Configure iptables for Discord bot

# Flush existing rules
iptables -F
iptables -X

# Default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH (change port if needed)
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTPS for reverse proxy (if using)
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Allow HTTP for Let's Encrypt challenges (if using)
iptables -A INPUT -p tcp --dport 80 -j ACCEPT

# Drop all other incoming traffic
iptables -A INPUT -j DROP

# Save rules
iptables-save > /etc/iptables/rules.v4
```

#### UFW Configuration (Ubuntu/Debian)

```bash
# Enable UFW
sudo ufw enable

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTPS (for reverse proxy)
sudo ufw allow 443/tcp

# Allow HTTP (for Let's Encrypt)
sudo ufw allow 80/tcp

# Check status
sudo ufw status verbose
```

#### Windows Firewall Configuration

```powershell
# PowerShell script - Run as Administrator

# Block all inbound by default
Set-NetFirewallProfile -All -DefaultInboundAction Block -DefaultOutboundAction Allow

# Allow inbound on specific ports (if needed)
New-NetFirewallRule -DisplayName "Discord Bot API" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow

# Allow Docker network traffic
New-NetFirewallRule -DisplayName "Docker Network" -Direction Inbound -RemoteAddress 172.20.0.0/16 -Action Allow
```

### TLS/SSL Configuration

#### Nginx Reverse Proxy with SSL

```nginx
# /etc/nginx/sites-available/discord-bot-api

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

# HTTPS Server
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    # SSL certificates (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # SSL configuration (Mozilla Intermediate)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;

    # HSTS (HTTP Strict Transport Security)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Proxy to API service
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;
}
```

#### Let's Encrypt SSL Setup

```bash
# Install Certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d api.yourdomain.com

# Auto-renewal (runs daily)
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

# Test renewal
sudo certbot renew --dry-run
```

#### SSL Certificate Monitoring

```bash
#!/bin/bash
# ssl-check.sh - Monitor SSL certificate expiration

DOMAIN="api.yourdomain.com"
DAYS_WARN=30

# Get expiration date
EXPIRY_DATE=$(echo | openssl s_client -servername $DOMAIN -connect $DOMAIN:443 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)

# Convert to timestamp
EXPIRY_TIMESTAMP=$(date -d "$EXPIRY_DATE" +%s)
CURRENT_TIMESTAMP=$(date +%s)
DAYS_REMAINING=$(( ($EXPIRY_TIMESTAMP - $CURRENT_TIMESTAMP) / 86400 ))

if [ $DAYS_REMAINING -lt $DAYS_WARN ]; then
    echo "⚠️ SSL certificate expires in $DAYS_REMAINING days!"
    # Send alert (email, Slack, etc.)
else
    echo "✅ SSL certificate valid for $DAYS_REMAINING days"
fi
```

### Rate Limiting Strategy

#### Application-Level Rate Limiting

Current implementation in `api/src/app.ts`:

```typescript
// Standard rate limit: 100 req/15min per IP
const limiter = rateLimit({
  windowMs: 900000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/ready'
});

// Strict rate limit: 20 req/15min for sensitive endpoints
const strictLimiter = rateLimit({
  windowMs: 900000,
  max: 20,
  message: 'Rate limit exceeded for sensitive operations'
});

// Apply rate limits
app.use(limiter);
app.use('/metrics', strictLimiter);
app.use('/api/v1/webhooks', strictLimiter);
```

#### Redis-Based Distributed Rate Limiting

For multi-instance deployments:

```typescript
// api/src/middleware/rate-limit.ts
import Redis from 'ioredis';
import { RateLimiterRedis } from 'rate-limiter-flexible';

const redis = new Redis(process.env.REDIS_URL);

const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rate_limit',
  points: 100, // Number of requests
  duration: 900, // Per 15 minutes
  blockDuration: 900, // Block for 15 minutes if exceeded
});

export async function rateLimitMiddleware(req, res, next) {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (error) {
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded',
      retryAfter: Math.ceil(error.msBeforeNext / 1000)
    });
  }
}
```

#### Nginx Rate Limiting

```nginx
# /etc/nginx/nginx.conf

http {
    # Rate limit zones
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=api:10m rate=5r/s;
    limit_req_zone $binary_remote_addr zone=webhook:10m rate=1r/s;

    # Burst configuration
    limit_req zone=general burst=20 nodelay;

    server {
        location /api/v1/ {
            limit_req zone=api burst=10 nodelay;
            proxy_pass http://127.0.0.1:3000;
        }

        location /api/v1/webhooks/ {
            limit_req zone=webhook burst=5 nodelay;
            proxy_pass http://127.0.0.1:3000;
        }
    }
}
```

---

## Database Security

### PostgreSQL Authentication

#### Password Security

```bash
# Generate strong password
openssl rand -base64 32

# Update .env
DATABASE_URL=postgresql://postgres:STRONG_PASSWORD_HERE@postgres:5432/discord
```

#### Connection String Security

**Bad Practice:**
```bash
# Insecure - password visible in logs
DATABASE_URL=postgresql://postgres:password123@postgres:5432/discord
```

**Good Practice:**
```bash
# Use connection string with URL encoding
PASSWORD='P@ssw0rd!#$'
ENCODED_PASSWORD=$(echo -n "$PASSWORD" | jq -sRr @uri)
DATABASE_URL="postgresql://postgres:${ENCODED_PASSWORD}@postgres:5432/discord"
```

#### PostgreSQL User Permissions

```sql
-- Connect to PostgreSQL
docker exec -it discord-postgres psql -U postgres

-- Create restricted user for application
CREATE USER discord_app WITH PASSWORD 'strong-password-here';

-- Grant limited permissions
GRANT CONNECT ON DATABASE discord TO discord_app;
GRANT USAGE ON SCHEMA public TO discord_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO discord_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO discord_app;

-- Prevent schema modifications
REVOKE CREATE ON SCHEMA public FROM discord_app;

-- Update connection string
DATABASE_URL=postgresql://discord_app:strong-password-here@postgres:5432/discord
```

### SQL Injection Prevention

#### Prisma ORM Safety

Prisma provides automatic SQL injection protection through parameterized queries:

```typescript
// ✅ SAFE - Prisma parameterizes queries
const user = await prisma.user.findUnique({
  where: { id: userInput }
});

// ✅ SAFE - Prisma escapes input
const tracks = await prisma.track.findMany({
  where: {
    title: { contains: searchQuery }
  }
});

// ⚠️ UNSAFE - Raw SQL without parameters
const result = await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userInput}`;

// ✅ SAFE - Raw SQL with parameters
const result = await prisma.$queryRaw`SELECT * FROM users WHERE id = ${userInput}`;
// Prisma automatically parameterizes even in raw queries
```

#### Input Validation with Zod

```typescript
// api/src/middleware/validation.ts
import { z } from 'zod';

export const guildIdSchema = z.string()
  .regex(/^\d{17,19}$/, 'Invalid Discord guild ID');

export const searchQuerySchema = z.string()
  .min(1, 'Search query too short')
  .max(100, 'Search query too long')
  .regex(/^[a-zA-Z0-9\s-]+$/, 'Invalid characters in search query');

// Usage
async function searchTracks(query: string) {
  const validated = searchQuerySchema.parse(query); // Throws if invalid
  return await prisma.track.findMany({
    where: { title: { contains: validated } }
  });
}
```

### Database Encryption

#### Transparent Data Encryption (TDE)

PostgreSQL doesn't support TDE natively, but you can:

1. **Encrypt entire volume** (recommended):
```bash
# Linux LUKS encryption
sudo cryptsetup luksFormat /dev/sdb1
sudo cryptsetup open /dev/sdb1 postgres_encrypted
sudo mkfs.ext4 /dev/mapper/postgres_encrypted
sudo mount /dev/mapper/postgres_encrypted /var/lib/postgresql/data
```

2. **Column-level encryption** with pgcrypto:
```sql
-- Enable pgcrypto extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create table with encrypted columns
CREATE TABLE sensitive_data (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  encrypted_token BYTEA,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert encrypted data
INSERT INTO sensitive_data (user_id, encrypted_token)
VALUES (
  '123456789',
  pgp_sym_encrypt('sensitive-token-data', current_setting('app.encryption_key'))
);

-- Query encrypted data
SELECT
  user_id,
  pgp_sym_decrypt(encrypted_token, current_setting('app.encryption_key')) AS token
FROM sensitive_data
WHERE user_id = '123456789';
```

3. **Application-level encryption**:
```typescript
// packages/database/src/encryption.ts
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.DATABASE_ENCRYPTION_KEY || '';
const ALGORITHM = 'aes-256-gcm';

export function encrypt(text: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex')
  };
}

export function decrypt(encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// Usage in Prisma middleware
prisma.$use(async (params, next) => {
  if (params.model === 'User' && params.action === 'create') {
    if (params.args.data.sensitiveField) {
      const { encrypted, iv, tag } = encrypt(params.args.data.sensitiveField);
      params.args.data.sensitiveField = encrypted;
      params.args.data.iv = iv;
      params.args.data.tag = tag;
    }
  }

  return next(params);
});
```

### Backup Security

#### Encrypted Database Backups

```bash
#!/bin/bash
# scripts/backup-database.sh - Secure database backup

BACKUP_DIR="/var/backups/discord-bot"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="discord_backup_${DATE}.sql"
ENCRYPTED_FILE="${BACKUP_FILE}.gpg"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Dump database
docker exec discord-postgres pg_dump -U postgres discord > "${BACKUP_DIR}/${BACKUP_FILE}"

# Encrypt backup with GPG
gpg --symmetric --cipher-algo AES256 --output "${BACKUP_DIR}/${ENCRYPTED_FILE}" "${BACKUP_DIR}/${BACKUP_FILE}"

# Remove unencrypted backup
rm "${BACKUP_DIR}/${BACKUP_FILE}"

# Set secure permissions
chmod 600 "${BACKUP_DIR}/${ENCRYPTED_FILE}"

# Upload to secure storage (S3, etc.)
aws s3 cp "${BACKUP_DIR}/${ENCRYPTED_FILE}" "s3://your-bucket/backups/" --sse AES256

# Cleanup old backups (keep 30 days)
find "$BACKUP_DIR" -name "*.gpg" -mtime +30 -delete

echo "✅ Backup completed: ${ENCRYPTED_FILE}"
```

#### Restore from Encrypted Backup

```bash
#!/bin/bash
# scripts/restore-database.sh - Restore from encrypted backup

BACKUP_FILE=$1

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: ./restore-database.sh <encrypted_backup_file.sql.gpg>"
    exit 1
fi

# Decrypt backup
gpg --decrypt --output /tmp/restore.sql "$BACKUP_FILE"

# Stop services
docker-compose stop gateway audio api worker

# Drop and recreate database
docker exec -it discord-postgres psql -U postgres -c "DROP DATABASE IF EXISTS discord;"
docker exec -it discord-postgres psql -U postgres -c "CREATE DATABASE discord;"

# Restore database
docker exec -i discord-postgres psql -U postgres discord < /tmp/restore.sql

# Remove decrypted file
rm /tmp/restore.sql

# Restart services
docker-compose up -d

echo "✅ Database restored successfully"
```

#### Automated Backup Schedule

```bash
# Add to crontab: crontab -e
# Run backup daily at 2 AM
0 2 * * * /path/to/discord_bot/scripts/backup-database.sh >> /var/log/discord-bot-backup.log 2>&1

# Run backup weekly with long-term retention
0 3 * * 0 /path/to/discord_bot/scripts/backup-database.sh --weekly >> /var/log/discord-bot-backup.log 2>&1
```

---

## Container Security

### Docker Image Security

#### Multi-Stage Build Security

The Dockerfile implements security best practices:

```dockerfile
# Dockerfile (current implementation)

# Stage 1: Base - Minimal dependencies
FROM node:22-alpine AS base
RUN corepack enable pnpm \
  && apk add --no-cache openssl ca-certificates

# Stage 2: Builder - Compile application
FROM base AS builder
COPY . .
RUN pnpm install --no-frozen-lockfile \
  && pnpm -r build

# Stage 3: Production - Minimal runtime image
FROM node:22-alpine AS production

# Security: Run as non-root user
RUN addgroup -g 1001 nodejs \
  && adduser -D -u 1001 -G nodejs nextjs

USER nextjs  # ✅ Non-root execution

COPY --from=builder --chown=nextjs:nodejs /app ./app

CMD ["node", "gateway/dist/index.js"]
```

#### Image Scanning

```bash
# Scan with Trivy (recommended)
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image discord-bot-gateway:latest

# Scan with Snyk
snyk container test discord-bot-gateway:latest

# Scan with Docker Scout
docker scout cves discord-bot-gateway:latest

# Expected output: No critical vulnerabilities
```

#### Base Image Security

```dockerfile
# Use specific versions (not 'latest')
FROM node:22.5.1-alpine3.19 AS base  # ✅ Pinned version

# Verify image signatures (Docker Content Trust)
# export DOCKER_CONTENT_TRUST=1
FROM node:22-alpine@sha256:abc123...  # ✅ SHA256 digest
```

### Non-Root User Execution

#### Verify Non-Root Execution

```bash
# Check running user
docker exec discord-gateway whoami
# Expected output: nextjs

docker exec discord-gateway id
# Expected output: uid=1001(nextjs) gid=1001(nodejs)

# Verify process ownership
docker exec discord-gateway ps aux
# All processes should run as 'nextjs', not 'root'
```

#### File Permissions for Non-Root

```dockerfile
# Dockerfile - Ensure correct permissions

COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Create writable directories
RUN mkdir -p /app/logs \
  && chown -R nextjs:nodejs /app/logs \
  && chmod 755 /app/logs

USER nextjs
```

### Volume Permissions

#### Secure Volume Configuration

```yaml
# docker-compose.yml - Production volume security
volumes:
  postgres_data:
    driver: local
    driver_opts:
      type: none
      o: bind,mode=0700  # Owner read/write/execute only
      device: /var/lib/discord-bot/postgres

  logs:
    driver: local
    driver_opts:
      type: none
      o: bind,mode=0750  # Owner RWX, group RX
      device: /var/log/discord-bot
```

#### Volume Permission Setup

```bash
# Create volume directories with proper permissions
sudo mkdir -p /var/lib/discord-bot/{postgres,redis,lavalink}
sudo mkdir -p /var/log/discord-bot

# Set ownership
sudo chown -R 1001:1001 /var/lib/discord-bot
sudo chown -R 1001:1001 /var/log/discord-bot

# Set permissions
sudo chmod 700 /var/lib/discord-bot/postgres  # Database data
sudo chmod 700 /var/lib/discord-bot/redis     # Cache data
sudo chmod 755 /var/log/discord-bot           # Logs (readable by monitoring tools)

# Verify permissions
ls -la /var/lib/discord-bot/
# Expected: drwx------ 1001 1001 postgres
```

### Security Scanning

#### Automated Vulnerability Scanning

```bash
#!/bin/bash
# scripts/security-scan.sh - Comprehensive security scan

echo "🔍 Running security scans..."

# 1. Scan Docker images
echo "Scanning Docker images with Trivy..."
docker-compose ps --format json | jq -r '.[].Image' | while read image; do
    trivy image --severity HIGH,CRITICAL "$image"
done

# 2. Scan dependencies
echo "Scanning npm dependencies..."
pnpm audit --audit-level=high

# 3. Scan for secrets
echo "Scanning for secrets with gitleaks..."
docker run --rm -v "$(pwd):/path" zricethezav/gitleaks:latest detect --source="/path" --verbose

# 4. Scan Infrastructure as Code
echo "Scanning docker-compose.yml with checkov..."
docker run --rm -v "$(pwd):/code" bridgecrew/checkov -f /code/docker-compose.yml

# 5. SAST (Static Application Security Testing)
echo "Running Semgrep..."
docker run --rm -v "$(pwd):/src" returntocorp/semgrep semgrep --config=auto /src

echo "✅ Security scan completed"
```

#### CI/CD Security Integration

```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'  # Weekly on Sunday

jobs:
  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'HIGH,CRITICAL'

      - name: Run npm audit
        run: pnpm audit --audit-level=high

      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

      - name: Upload results to GitHub Security
        uses: github/codeql-action/upload-sarif@v2
        with:
          sarif_file: trivy-results.sarif
```

---

## Monitoring & Auditing

### Sentry Error Tracking

#### Sentry Configuration

```bash
# .env - Sentry configuration
SENTRY_DSN=https://your-key@o123456.ingest.sentry.io/789012
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% of transactions
SENTRY_PROFILES_SAMPLE_RATE=0.1  # 10% of profiles
```

#### Sentry Integration

```typescript
// packages/logger/src/sentry.ts
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    console.warn('Sentry DSN not configured - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE || '0.1'),
    integrations: [
      new ProfilingIntegration(),
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app: true }),
    ],

    // Security: Filter sensitive data
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['x-api-key'];
        delete event.request.headers['cookie'];
      }

      // Remove sensitive environment variables
      if (event.contexts?.runtime?.env) {
        const sensitiveKeys = ['DISCORD_TOKEN', 'DATABASE_URL', 'API_KEY', 'WEBHOOK_SECRET'];
        sensitiveKeys.forEach(key => {
          delete event.contexts.runtime.env[key];
        });
      }

      return event;
    },
  });
}

// Capture security-relevant errors
export function captureSecurityEvent(error: Error, context: Record<string, any>) {
  Sentry.captureException(error, {
    tags: {
      type: 'security',
      severity: context.severity || 'medium',
    },
    extra: context,
  });
}
```

### Audit Log Implementation

#### Database Schema for Audit Logs

```sql
-- prisma/migrations/add_audit_log.sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  user_id VARCHAR(255),
  guild_id VARCHAR(255),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(255),
  changes JSONB,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_message TEXT,
  metadata JSONB,
  INDEX idx_audit_timestamp (timestamp),
  INDEX idx_audit_user (user_id),
  INDEX idx_audit_action (action),
  INDEX idx_audit_guild (guild_id)
);
```

#### Audit Logging Implementation

```typescript
// packages/database/src/audit-logger.ts
import { prisma } from './client.js';
import { logger } from '@discord-bot/logger';

export interface AuditLogEntry {
  userId?: string;
  guildId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  changes?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        timestamp: new Date(),
        userId: entry.userId,
        guildId: entry.guildId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        changes: entry.changes as any,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        success: entry.success,
        errorMessage: entry.errorMessage,
        metadata: entry.metadata as any,
      },
    });

    logger.info({
      action: entry.action,
      userId: entry.userId,
      success: entry.success
    }, 'Audit log created');
  } catch (error) {
    logger.error({ error, entry }, 'Failed to create audit log');
  }
}

// Usage examples
export const AuditActions = {
  // Authentication
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  API_KEY_USED: 'auth.api_key.used',
  API_KEY_INVALID: 'auth.api_key.invalid',

  // Music Control
  MUSIC_PLAY: 'music.play',
  MUSIC_PAUSE: 'music.pause',
  MUSIC_SKIP: 'music.skip',
  MUSIC_STOP: 'music.stop',

  // Administration
  SETTINGS_CHANGED: 'admin.settings.changed',
  PERMISSIONS_CHANGED: 'admin.permissions.changed',

  // Security Events
  RATE_LIMIT_EXCEEDED: 'security.rate_limit.exceeded',
  UNAUTHORIZED_ACCESS: 'security.unauthorized_access',
  SUSPICIOUS_ACTIVITY: 'security.suspicious_activity',
} as const;
```

#### Audit Log Middleware

```typescript
// api/src/middleware/audit-logger.ts
import { Request, Response, NextFunction } from 'express';
import { createAuditLog, AuditActions } from '@discord-bot/database';

export function auditMiddleware(action: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Capture original json method
    const originalJson = res.json.bind(res);

    res.json = function(body: any) {
      // Log after response
      const success = res.statusCode < 400;
      const duration = Date.now() - startTime;

      createAuditLog({
        userId: req.body?.userId,
        guildId: req.body?.guildId,
        action,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success,
        errorMessage: success ? undefined : body?.error,
        metadata: {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
        },
      });

      return originalJson(body);
    };

    next();
  };
}

// Usage in routes
router.post('/music/play',
  auditMiddleware(AuditActions.MUSIC_PLAY),
  asyncHandler(async (req, res) => {
    // Handle request...
  })
);
```

### Security Metrics (Prometheus)

#### Security Metrics Configuration

```typescript
// packages/observability/src/security-metrics.ts
import { Counter, Histogram, Gauge, Registry } from 'prom-client';

const registry = new Registry();

// Authentication metrics
export const authAttempts = new Counter({
  name: 'auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['type', 'result'],
  registers: [registry],
});

export const apiKeyUsage = new Counter({
  name: 'api_key_usage_total',
  help: 'Total API key usage attempts',
  labelNames: ['endpoint', 'valid'],
  registers: [registry],
});

// Rate limiting metrics
export const rateLimitHits = new Counter({
  name: 'rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['endpoint', 'ip'],
  registers: [registry],
});

// Security events
export const securityEvents = new Counter({
  name: 'security_events_total',
  help: 'Total security events',
  labelNames: ['type', 'severity'],
  registers: [registry],
});

// Failed login attempts per IP
export const failedLoginsByIP = new Counter({
  name: 'failed_logins_by_ip_total',
  help: 'Failed login attempts by IP address',
  labelNames: ['ip'],
  registers: [registry],
});

// Webhook signature verification
export const webhookVerification = new Counter({
  name: 'webhook_verification_total',
  help: 'Webhook signature verification attempts',
  labelNames: ['result'],
  registers: [registry],
});

// SSL certificate expiration (days remaining)
export const sslCertExpiration = new Gauge({
  name: 'ssl_cert_expiration_days',
  help: 'Days until SSL certificate expiration',
  labelNames: ['domain'],
  registers: [registry],
});

export { registry };
```

#### Security Metrics Usage

```typescript
// api/src/app.ts - Track security events
import { authAttempts, rateLimitHits, webhookVerification } from '@discord-bot/observability';

// In API key middleware
if (apiKey !== expectedApiKey) {
  authAttempts.inc({ type: 'api_key', result: 'failure' });
  return next(new UnauthorizedError('Invalid API key'));
}
authAttempts.inc({ type: 'api_key', result: 'success' });

// In rate limiter
app.use((req, res, next) => {
  if (isRateLimited(req)) {
    rateLimitHits.inc({ endpoint: req.path, ip: req.ip });
  }
  next();
});

// In webhook verification
if (verifyWebhookSignature(req)) {
  webhookVerification.inc({ result: 'success' });
} else {
  webhookVerification.inc({ result: 'failure' });
}
```

#### Grafana Dashboard for Security Metrics

```json
{
  "dashboard": {
    "title": "Discord Bot - Security Dashboard",
    "panels": [
      {
        "title": "Authentication Attempts",
        "targets": [
          {
            "expr": "rate(auth_attempts_total[5m])",
            "legendFormat": "{{result}}"
          }
        ]
      },
      {
        "title": "Rate Limit Hits",
        "targets": [
          {
            "expr": "rate(rate_limit_hits_total[5m])",
            "legendFormat": "{{endpoint}}"
          }
        ]
      },
      {
        "title": "Security Events by Severity",
        "targets": [
          {
            "expr": "security_events_total",
            "legendFormat": "{{severity}}"
          }
        ]
      },
      {
        "title": "Failed Logins by IP (Top 10)",
        "targets": [
          {
            "expr": "topk(10, failed_logins_by_ip_total)",
            "legendFormat": "{{ip}}"
          }
        ]
      }
    ]
  }
}
```

### Intrusion Detection

#### Log Analysis for Suspicious Activity

```bash
#!/bin/bash
# scripts/detect-intrusions.sh - Analyze logs for security threats

LOG_DIR="/var/log/discord-bot"
ALERT_THRESHOLD=10

echo "🔍 Analyzing logs for security threats..."

# Check for repeated failed auth attempts
echo "Checking for brute force attacks..."
FAILED_AUTHS=$(grep "Invalid API key attempt" "$LOG_DIR"/*.log | wc -l)
if [ "$FAILED_AUTHS" -gt "$ALERT_THRESHOLD" ]; then
    echo "⚠️  WARNING: $FAILED_AUTHS failed authentication attempts detected!"
fi

# Check for SQL injection attempts
echo "Checking for SQL injection attempts..."
SQL_PATTERNS="('OR|DROP TABLE|UNION SELECT|EXEC|xp_cmdshell)"
grep -E "$SQL_PATTERNS" "$LOG_DIR"/*.log && echo "⚠️  SQL injection attempt detected!"

# Check for path traversal attempts
echo "Checking for path traversal attacks..."
PATH_PATTERNS="(\.\./|\.\.\\|\.\./\.\./)"
grep -E "$PATH_PATTERNS" "$LOG_DIR"/*.log && echo "⚠️  Path traversal attempt detected!"

# Check for unusual API access patterns
echo "Checking for unusual API access patterns..."
HIGH_REQ_IPS=$(grep "rate_limit" "$LOG_DIR"/*.log | awk '{print $NF}' | sort | uniq -c | sort -rn | head -5)
echo "Top IPs hitting rate limits:"
echo "$HIGH_REQ_IPS"

# Check for webhook forgery attempts
echo "Checking for webhook signature failures..."
WEBHOOK_FAILURES=$(grep "Invalid webhook signature" "$LOG_DIR"/*.log | wc -l)
if [ "$WEBHOOK_FAILURES" -gt 0 ]; then
    echo "⚠️  WARNING: $WEBHOOK_FAILURES webhook signature verification failures!"
fi

echo "✅ Intrusion detection complete"
```

#### Fail2Ban Configuration

```ini
# /etc/fail2ban/jail.d/discord-bot.conf
[discord-bot-auth]
enabled = true
port = 3000
filter = discord-bot-auth
logpath = /var/log/discord-bot/*.log
maxretry = 5
bantime = 3600
findtime = 600
action = iptables-multiport[name=discord-bot, port="3000,3001,3002,3003"]

# /etc/fail2ban/filter.d/discord-bot-auth.conf
[Definition]
failregex = ^.*Invalid API key attempt.*ip=<HOST>.*$
            ^.*Invalid webhook signature.*ip=<HOST>.*$
            ^.*Unauthorized access.*ip=<HOST>.*$
ignoreregex =
```

### Log Security

#### Secure Log Storage

```yaml
# docker-compose.yml - Secure logging configuration
services:
  gateway:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
        compress: "true"
        labels: "service,environment"
        env: "NODE_ENV"
    volumes:
      - ./logs:/app/logs:rw
```

#### Log Rotation

```bash
# /etc/logrotate.d/discord-bot
/var/log/discord-bot/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 nextjs nodejs
    sharedscripts
    postrotate
        docker-compose restart gateway audio api worker
    endscript
}
```

#### Sanitize Logs

```typescript
// packages/logger/src/sanitizer.ts
const SENSITIVE_PATTERNS = [
  /DISCORD_TOKEN=[^\s]+/g,
  /API_KEY=[^\s]+/g,
  /password=[^\s&]+/gi,
  /token=[^\s&]+/gi,
  /authorization:\s*[^\s]+/gi,
  /\d{13,19}/g,  // Discord snowflakes (optional - may break debugging)
];

export function sanitizeLog(message: string): string {
  let sanitized = message;

  SENSITIVE_PATTERNS.forEach(pattern => {
    sanitized = sanitized.replace(pattern, (match) => {
      const key = match.split('=')[0];
      return `${key}=[REDACTED]`;
    });
  });

  return sanitized;
}

// Usage in logger
logger.info(sanitizeLog(message));
```

---

## Security Best Practices

### Production Deployment Checklist

Use this checklist before deploying to production:

#### 1. Secrets Management
- [ ] All secrets stored in `.env` (not in code)
- [ ] `.env` file is in `.gitignore`
- [ ] No secrets committed to git history (`git log -p | grep -i password`)
- [ ] Strong passwords generated for all services (32+ characters)
- [ ] API keys rotated from development defaults
- [ ] Discord token is production-only (separate from dev)

#### 2. Authentication & Authorization
- [ ] API_KEY configured and unique
- [ ] WEBHOOK_SECRET configured with strong random value
- [ ] DJ_ROLE_NAME configured appropriately
- [ ] Database credentials use strong passwords
- [ ] Lavalink password changed from default

#### 3. Network Security
- [ ] Firewall configured (only necessary ports open)
- [ ] PostgreSQL port NOT exposed externally (remove `ports:` in docker-compose)
- [ ] Redis port NOT exposed externally
- [ ] Lavalink port NOT exposed externally
- [ ] API behind reverse proxy with TLS
- [ ] SSL certificate installed and valid
- [ ] HSTS header enabled
- [ ] Rate limiting configured

#### 4. Database Security
- [ ] PostgreSQL uses restricted user (not `postgres`)
- [ ] Database backups automated and encrypted
- [ ] Sensitive data encrypted at rest
- [ ] Connection string uses strong password
- [ ] Prisma migrations applied

#### 5. Container Security
- [ ] All services run as non-root users
- [ ] Docker images scanned for vulnerabilities
- [ ] Base images pinned to specific versions
- [ ] Volume permissions set correctly (chmod 700 for sensitive data)
- [ ] Security scanning in CI/CD pipeline

#### 6. Monitoring & Logging
- [ ] Sentry configured for error tracking
- [ ] Audit logging enabled
- [ ] Prometheus metrics exposed (protected by API key)
- [ ] Log rotation configured
- [ ] Sensitive data sanitized in logs
- [ ] Security alerts configured

#### 7. Code Security
- [ ] All dependencies updated (`pnpm update`)
- [ ] No high/critical npm vulnerabilities (`pnpm audit`)
- [ ] Input validation with Zod schemas
- [ ] SQL injection protection (Prisma ORM)
- [ ] XSS protection (Content Security Policy)
- [ ] CORS configured restrictively

#### 8. Compliance & Privacy
- [ ] Discord ToS compliance verified
- [ ] Privacy policy documented
- [ ] Data retention policy implemented
- [ ] GDPR considerations reviewed (if applicable)
- [ ] User data deletion mechanism implemented

#### 9. Operational Security
- [ ] Backup and restore procedures tested
- [ ] Incident response plan documented
- [ ] Security contact information updated
- [ ] SSH keys configured (no password auth)
- [ ] Server OS updated and patched
- [ ] Docker daemon secured

#### 10. Application Security
- [ ] Environment set to `production` (NODE_ENV=production)
- [ ] Debug logging disabled in production
- [ ] Source maps not deployed to production
- [ ] Health check endpoints functional
- [ ] Graceful shutdown implemented

### Security Audit Schedule

| Task | Frequency | Owner | Automation |
|------|-----------|-------|------------|
| Dependency updates | Weekly | DevOps | Dependabot |
| Security scans | Daily | CI/CD | GitHub Actions |
| Log review | Daily | Security | Automated alerts |
| Access audit | Monthly | Security | Manual |
| Penetration testing | Quarterly | Security | External vendor |
| SSL certificate renewal | Every 60 days | DevOps | Certbot |
| Password rotation | Every 90 days | Security | Manual |
| Backup verification | Monthly | DevOps | Automated |
| Security training | Quarterly | All team | Manual |
| Incident response drill | Annually | Security | Manual |

### Incident Response Plan

#### Phase 1: Detection & Analysis (0-15 minutes)

```bash
# 1. Detect incident (alerts, logs, reports)
# 2. Assess severity
# 3. Notify team

# Quick security check
./scripts/security-scan.sh

# Check for active attacks
docker-compose logs --tail=100 | grep -E "(ERROR|WARN|attack|unauthorized)"
```

#### Phase 2: Containment (15-30 minutes)

```bash
# Option A: Isolate affected service
docker-compose stop gateway

# Option B: Enable maintenance mode
docker-compose down

# Option C: Block attacker IP
sudo ufw deny from <attacker-ip>
```

#### Phase 3: Eradication (30-60 minutes)

```bash
# 1. Identify root cause
# 2. Remove threat (malicious code, backdoors)
# 3. Patch vulnerability

# Rotate compromised secrets
./scripts/rotate-secrets.sh

# Update vulnerable dependencies
pnpm update
```

#### Phase 4: Recovery (60-120 minutes)

```bash
# 1. Restore from clean backup (if needed)
./scripts/restore-database.sh latest-backup.sql.gpg

# 2. Restart services
docker-compose up -d

# 3. Verify functionality
./scripts/health-check.sh
```

#### Phase 5: Post-Incident (1-7 days)

1. **Document incident** - Write incident report
2. **Root cause analysis** - Identify systemic issues
3. **Implement fixes** - Prevent recurrence
4. **Update procedures** - Improve response plan
5. **Team debrief** - Share learnings

### Vulnerability Disclosure Policy

See [Vulnerability Reporting](#vulnerability-reporting) section below.

### Dependency Update Strategy

```bash
# Weekly dependency update workflow

# 1. Check for outdated dependencies
pnpm outdated

# 2. Update non-breaking changes
pnpm update

# 3. Test thoroughly
pnpm test
pnpm typecheck
pnpm lint

# 4. Check for vulnerabilities
pnpm audit --audit-level=high

# 5. Review breaking changes (major updates)
# Update manually with caution

# 6. Commit and deploy
git add package.json pnpm-lock.yaml
git commit -m "chore: update dependencies (security patches)"
git push
```

#### Automated Dependency Updates

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    reviewers:
      - "security-team"
    labels:
      - "dependencies"
      - "security"
    commit-message:
      prefix: "chore"
      prefix-development: "chore"
      include: "scope"
    # Security updates
    versioning-strategy: increase-if-necessary
```

---

## Compliance & Privacy

### Discord Terms of Service Compliance

#### Key Requirements

1. **Bot Token Security** - Never share or expose bot tokens
2. **API Rate Limits** - Respect Discord's rate limits (50 requests/second per route)
3. **User Privacy** - Don't store messages unless necessary
4. **Prohibited Content** - Don't facilitate ToS violations
5. **Verified Bot Requirements** - For 75+ servers, verification required

#### Compliance Checklist

- [ ] Bot token secured in environment variables
- [ ] Rate limiting implemented (Express rate limiter)
- [ ] Message content only accessed when needed (no persistent storage)
- [ ] User data limited to necessary fields (user ID, preferences)
- [ ] Privacy policy accessible to users
- [ ] Bot respects server-specific permissions
- [ ] No spam or automated user messages
- [ ] No self-botting or user token usage

#### Resources

- Discord Developer ToS: https://discord.com/developers/docs/policies-and-agreements/terms-of-service
- Discord Bot Best Practices: https://discord.com/developers/docs/topics/community-resources#bots-and-apps

### Data Retention Policies

#### Current Data Storage

| Data Type | Storage Location | Retention Period | Purpose |
|-----------|-----------------|------------------|---------|
| Guild Settings | PostgreSQL | Until bot removed | Bot configuration |
| Music Queue | Redis + PostgreSQL | 24 hours | Playback management |
| Audit Logs | PostgreSQL | 90 days | Security monitoring |
| Error Logs | File system | 30 days | Debugging |
| Metrics | Prometheus | 15 days | Performance monitoring |
| User Preferences | PostgreSQL | Until user requests deletion | Personalization |

#### Data Retention Configuration

```typescript
// worker/src/jobs/cleanup-jobs.ts
import { prisma } from '@discord-bot/database';
import { logger } from '@discord-bot/logger';

// Cleanup old audit logs (90 days)
export async function cleanupAuditLogs() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 90);

  const deleted = await prisma.auditLog.deleteMany({
    where: {
      timestamp: {
        lt: cutoffDate
      }
    }
  });

  logger.info({ count: deleted.count }, 'Cleaned up old audit logs');
}

// Cleanup completed queues (24 hours)
export async function cleanupOldQueues() {
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - 24);

  const deleted = await prisma.queue.deleteMany({
    where: {
      status: 'completed',
      updatedAt: {
        lt: cutoffDate
      }
    }
  });

  logger.info({ count: deleted.count }, 'Cleaned up old queues');
}

// Schedule cleanup jobs
import cron from 'node-cron';

// Run daily at 2 AM
cron.schedule('0 2 * * *', async () => {
  await cleanupAuditLogs();
  await cleanupOldQueues();
});
```

### GDPR Considerations

#### User Data Rights

If your bot operates in the EU, implement these GDPR rights:

1. **Right to Access** - Users can request their data
2. **Right to Deletion** - Users can request data deletion
3. **Right to Rectification** - Users can correct their data
4. **Right to Portability** - Users can export their data

#### GDPR Compliance Implementation

```typescript
// api/src/routes/v1/gdpr.ts
import { Router } from 'express';
import { prisma } from '@discord-bot/database';
import { asyncHandler } from '../../middleware/async-handler.js';

const router = Router();

// Right to Access - Export user data
router.get('/data/export/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const userData = {
    user: await prisma.user.findUnique({ where: { id: userId } }),
    preferences: await prisma.userPreference.findMany({ where: { userId } }),
    auditLogs: await prisma.auditLog.findMany({ where: { userId } }),
  };

  res.json({
    message: 'User data export',
    data: userData,
    timestamp: new Date().toISOString(),
  });
}));

// Right to Deletion - Delete user data
router.delete('/data/delete/:userId', asyncHandler(async (req, res) => {
  const { userId } = req.params;

  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { userId } }),
    prisma.userPreference.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);

  res.json({
    message: 'User data deleted successfully',
    userId,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
```

#### Privacy Policy Template

```markdown
# Privacy Policy - Discord Music Bot

**Last Updated:** [DATE]

## Data Collection

We collect minimal data necessary for bot functionality:
- Discord User ID (for identifying users)
- Guild ID (for server-specific settings)
- Music preferences (for autoplay recommendations)
- Command usage logs (for debugging and analytics)

## Data Usage

Your data is used exclusively for:
- Providing music playback services
- Personalizing your experience
- Improving bot performance
- Security and fraud prevention

## Data Storage

- Data stored on secure servers in [REGION]
- Database encrypted at rest
- Access restricted to authorized personnel
- Regular security audits performed

## Data Retention

- Guild settings: Until bot removed from server
- User preferences: Until you request deletion
- Audit logs: 90 days
- Error logs: 30 days

## Your Rights

- **Access**: Request a copy of your data
- **Deletion**: Request deletion of your data
- **Portability**: Export your data in JSON format
- **Rectification**: Correct inaccurate data

To exercise your rights, contact: [EMAIL]

## Third-Party Services

We use these third-party services:
- Discord (https://discord.com/privacy)
- Sentry (error tracking)
- Spotify API (music metadata)

## Changes to Policy

We may update this policy. Notification provided via bot announcement.

## Contact

Questions? Email: [EMAIL]
```

### Privacy Settings

```typescript
// Implement user privacy controls
router.post('/privacy/settings', asyncHandler(async (req, res) => {
  const { userId, settings } = req.body;

  await prisma.userPreference.upsert({
    where: { userId },
    update: {
      enableAnalytics: settings.analytics ?? true,
      enablePersonalization: settings.personalization ?? true,
      dataRetention: settings.retention ?? 'default',
    },
    create: {
      userId,
      enableAnalytics: settings.analytics ?? true,
      enablePersonalization: settings.personalization ?? true,
      dataRetention: settings.retention ?? 'default',
    },
  });

  res.json({ message: 'Privacy settings updated' });
}));
```

---

## Security Audit Checklist

### Pre-Deployment Security Audit

Use this comprehensive checklist before production deployment:

#### Infrastructure Security

```bash
# ✅ Check Docker configuration
docker-compose config | grep -E "(ports|volumes|environment)"

# ✅ Verify firewall rules
sudo ufw status verbose

# ✅ Check SSL certificate
openssl s_client -connect api.yourdomain.com:443 -servername api.yourdomain.com

# ✅ Scan for open ports
nmap -sV localhost

# ✅ Verify non-root execution
docker exec gateway whoami  # Should output: nextjs
docker exec audio whoami    # Should output: nextjs

# ✅ Check volume permissions
ls -la /var/lib/discord-bot/
```

#### Secrets & Configuration

```bash
# ✅ Verify .env is gitignored
git check-ignore .env

# ✅ Check for committed secrets
git log -p | grep -E "(token|password|secret|key)" -i

# ✅ Validate environment variables
docker-compose config | grep -E "DISCORD_TOKEN|API_KEY|DATABASE_URL"

# ✅ Ensure strong passwords
# All passwords should be 32+ characters, random
```

#### Application Security

```bash
# ✅ Run security scans
./scripts/security-scan.sh

# ✅ Check for vulnerabilities
pnpm audit --audit-level=high

# ✅ Update dependencies
pnpm outdated

# ✅ Run tests
pnpm test

# ✅ Type check
pnpm typecheck

# ✅ Lint code
pnpm lint
```

#### Network Security

```bash
# ✅ Verify internal network isolation
docker network inspect discord-network

# ✅ Check exposed ports
docker-compose ps

# ✅ Test rate limiting
ab -n 200 -c 10 http://localhost:3000/api/v1/health

# ✅ Verify TLS configuration (if using HTTPS)
testssl.sh api.yourdomain.com
```

#### Authentication & Authorization

```bash
# ✅ Test API key validation
curl -H "X-API-Key: invalid" http://localhost:3000/api/v1/guilds
# Should return: 401 Unauthorized

# ✅ Test webhook signature
curl -X POST http://localhost:3000/api/v1/webhooks/music/play \
  -H "Content-Type: application/json" \
  -d '{"guildId":"123","query":"test"}'
# Should return: 401 Unauthorized (missing signature)

# ✅ Verify CORS configuration
curl -H "Origin: http://evil.com" http://localhost:3000/api/v1/health
# Should block or not return CORS headers
```

#### Database Security

```bash
# ✅ Verify database authentication
docker exec discord-postgres psql -U postgres -c "\du"

# ✅ Check database permissions
docker exec discord-postgres psql -U postgres -d discord -c "\dp"

# ✅ Test backup/restore
./scripts/backup-database.sh
./scripts/restore-database.sh latest-backup.sql.gpg
```

#### Monitoring & Logging

```bash
# ✅ Verify Sentry integration
# Check for errors at: sentry.io

# ✅ Check Prometheus metrics
curl http://localhost:3000/metrics

# ✅ Verify log rotation
cat /etc/logrotate.d/discord-bot

# ✅ Check audit logs
docker exec discord-postgres psql -U postgres -d discord \
  -c "SELECT COUNT(*) FROM audit_logs WHERE timestamp > NOW() - INTERVAL '1 day';"
```

#### Incident Response

```bash
# ✅ Verify backup procedures
./scripts/backup-database.sh

# ✅ Test restore procedures
./scripts/restore-database.sh test-backup.sql.gpg

# ✅ Document incident response contacts
cat docs/operations/INCIDENT_RESPONSE.md

# ✅ Review security alerts
# Check Sentry, Grafana, email alerts
```

---

## Vulnerability Reporting

### How to Report Security Issues

We take security vulnerabilities seriously. Please report them responsibly.

#### Reporting Process

1. **DO NOT** create a public GitHub issue
2. **DO NOT** discuss vulnerability publicly
3. **DO** email security contact privately
4. **DO** provide detailed information

#### Contact Information

- **Email:** [Your security email address]
- **PGP Key:** [Optional - for encrypted communication]
- **Response Time:** Within 48 hours

#### What to Include

```markdown
# Vulnerability Report Template

## Summary
[Brief description of the vulnerability]

## Severity
- [ ] Critical (RCE, data breach)
- [ ] High (privilege escalation, auth bypass)
- [ ] Medium (information disclosure)
- [ ] Low (minor security issue)

## Environment
- Component: [gateway/audio/api/database]
- Version: [git commit hash or version]
- Configuration: [relevant settings]

## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

## Impact
[What can an attacker do with this vulnerability?]

## Proof of Concept
[Code, screenshots, or logs demonstrating the issue]

## Suggested Fix
[Optional - proposed solution]

## Contact
- Name: [Your name]
- Email: [Your email]
- Disclosure: [Public / Private / Anonymous]
```

#### Response Timeline

| Stage | Timeline | Action |
|-------|----------|--------|
| Acknowledgment | 48 hours | Confirm receipt of report |
| Initial Assessment | 7 days | Evaluate severity and impact |
| Fix Development | 30 days | Develop and test patch |
| Disclosure | 90 days | Public disclosure (coordinated) |

#### Security Advisories

Published security advisories will include:
- CVE ID (if applicable)
- Affected versions
- Severity rating (CVSS score)
- Patch information
- Credit to researcher (if desired)

### Bug Bounty Program

Currently, this project does not have a paid bug bounty program. However:

- **Acknowledgment:** Security researchers will be credited in advisories
- **Hall of Fame:** Top contributors listed in SECURITY.md
- **Swag:** Stickers/merch for significant findings (if available)

### Responsible Disclosure Guidelines

We follow industry-standard responsible disclosure:

1. **90-Day Disclosure Timeline** - Vulnerabilities disclosed after 90 days or when fix is deployed
2. **Coordinated Disclosure** - Work together on timing and details
3. **No Active Exploitation** - Don't exploit vulnerabilities beyond proof-of-concept
4. **Limited Scope** - Only test against your own instances

### Out of Scope

These issues are **NOT** considered security vulnerabilities:

- Denial of Service via bot commands (rate limiting expected)
- Discord API rate limiting
- Bugs requiring physical access to server
- Social engineering attacks
- Browser-specific issues not affecting the bot
- Vulnerabilities in third-party dependencies (report to maintainers directly)

---

## Security Resources

### Security Tools

#### Scanning & Analysis

- **Trivy** - Container vulnerability scanner
  - Installation: `brew install aquasecurity/trivy/trivy`
  - Usage: `trivy image discord-bot-gateway:latest`

- **Snyk** - Dependency vulnerability scanner
  - Website: https://snyk.io/
  - Usage: `snyk test`

- **npm audit** - Built-in npm vulnerability checker
  - Usage: `pnpm audit --audit-level=high`

- **OWASP ZAP** - Web application security scanner
  - Website: https://www.zaproxy.org/
  - Usage: Proxy requests through ZAP for API testing

- **Semgrep** - Static analysis security testing
  - Website: https://semgrep.dev/
  - Usage: `semgrep --config=auto`

#### Secrets Management

- **git-secrets** - Prevent committing secrets
  - Installation: `brew install git-secrets`
  - Usage: `git secrets --scan`

- **gitleaks** - Detect hardcoded secrets
  - Installation: `brew install gitleaks`
  - Usage: `gitleaks detect --source . --verbose`

- **HashiCorp Vault** - Enterprise secrets management
  - Website: https://www.vaultproject.io/

#### Encryption

- **OpenSSL** - Encryption toolkit
  - Usage: `openssl enc -aes-256-cbc -salt -in file.txt -out file.enc`

- **GPG** - GNU Privacy Guard
  - Usage: `gpg --symmetric --cipher-algo AES256 file.txt`

#### Monitoring

- **Fail2Ban** - Intrusion prevention
  - Installation: `sudo apt-get install fail2ban`

- **Sentry** - Error tracking
  - Website: https://sentry.io/

- **Prometheus** - Metrics monitoring
  - Website: https://prometheus.io/

- **Grafana** - Metrics visualization
  - Website: https://grafana.com/

### Security Guides & References

#### Discord Security

- Discord Developer Portal: https://discord.com/developers/docs
- Discord Security Best Practices: https://discord.com/safety
- Bot Token Security: https://discord.com/developers/docs/topics/oauth2#bot-vs-user-accounts

#### Docker Security

- Docker Security Best Practices: https://docs.docker.com/engine/security/
- CIS Docker Benchmark: https://www.cisecurity.org/benchmark/docker
- Docker Security Scanning: https://docs.docker.com/engine/scan/

#### Node.js Security

- Node.js Security Best Practices: https://nodejs.org/en/docs/guides/security/
- Express Security Best Practices: https://expressjs.com/en/advanced/best-practice-security.html
- OWASP Node.js Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html

#### Database Security

- PostgreSQL Security: https://www.postgresql.org/docs/current/security.html
- Prisma Security: https://www.prisma.io/docs/concepts/components/prisma-client/deployment#security

#### General Security

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- CWE Top 25: https://cwe.mitre.org/top25/
- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework

### Security Training

#### Online Courses

- **PortSwigger Web Security Academy** (Free)
  - URL: https://portswigger.net/web-security
  - Topics: SQLi, XSS, CSRF, Auth vulnerabilities

- **OWASP Secure Coding Practices**
  - URL: https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/

- **Cybrary Security Training**
  - URL: https://www.cybrary.it/

#### Books

- "Web Application Security" by Andrew Hoffman
- "The Web Application Hacker's Handbook" by Dafydd Stuttard
- "Bulletproof SSL and TLS" by Ivan Ristić

### Security Communities

- **OWASP** - Open Web Application Security Project
  - Website: https://owasp.org/

- **Discord Developers** - Official Discord dev community
  - Server: https://discord.gg/discord-developers

- **r/netsec** - Network security subreddit
  - URL: https://www.reddit.com/r/netsec/

### Compliance Standards

- **PCI DSS** - Payment Card Industry Data Security Standard
- **SOC 2** - Service Organization Control 2
- **ISO 27001** - Information Security Management
- **GDPR** - General Data Protection Regulation

### Security Newsletters

- **Node.js Security Newsletter** - https://nodejs.org/en/blog/
- **Docker Security Newsletter** - https://www.docker.com/newsletter-subscription
- **OWASP Newsletter** - https://owasp.org/
- **Snyk Security Newsletter** - https://snyk.io/advisor

---

## Appendix: Security Commands Reference

### Quick Security Commands

```bash
# === Environment & Secrets ===
# Check for exposed secrets
git log -p | grep -iE "(token|password|secret|key)"

# Verify .env is gitignored
git check-ignore .env

# Generate secure random password
openssl rand -base64 32

# === Docker Security ===
# Scan Docker image
trivy image discord-bot-gateway:latest

# Check running user in container
docker exec gateway whoami

# Inspect container security
docker inspect gateway --format='{{.State.Running}} {{.HostConfig.Privileged}}'

# === Network Security ===
# Check open ports
nmap -sV localhost

# Test SSL certificate
openssl s_client -connect api.yourdomain.com:443

# Verify firewall rules
sudo ufw status verbose

# === Application Security ===
# Run security scan
pnpm audit --audit-level=high

# Update dependencies
pnpm update

# Check for outdated packages
pnpm outdated

# === Database Security ===
# Backup database (encrypted)
./scripts/backup-database.sh

# Check database users
docker exec discord-postgres psql -U postgres -c "\du"

# === Monitoring ===
# Check logs for security events
docker-compose logs | grep -iE "(error|warn|unauthorized|invalid)"

# View audit logs
docker exec discord-postgres psql -U postgres -d discord \
  -c "SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10;"
```

---

## Document Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0.0 | 2025-10-31 | Initial security documentation | Claude |

---

**Security Notice:** This document contains sensitive information about system security. Distribute only to authorized personnel. Report any security concerns immediately.

**Document Classification:** Internal - Operations

**Last Security Audit:** [Date of last audit]

**Next Security Review:** [Date + 90 days]
