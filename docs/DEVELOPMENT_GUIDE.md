# 🛠️ Development Guide - Discord Music Bot

## 🎯 **Development Overview**

This guide provides comprehensive instructions for developers to set up, develop, test, and deploy the Discord music bot. The project supports multiple architecture patterns and development approaches.

---

## 🚀 **Quick Start**

### **Prerequisites**
- **Node.js 22+** (LTS recommended)
- **pnpm 8+** (package manager)
- **Java 17+** (for Lavalink server)
- **PostgreSQL 15+** (for database)
- **Redis 7+** (for caching and pub/sub)
- **Git** (version control)

### **1. Repository Setup**
```bash
# Clone the repository
git clone <repository-url>
cd discord_bot

# Install dependencies using pnpm workspaces
pnpm install

# Copy environment configuration
cp .env.example .env
```

### **2. Environment Configuration**
Edit `.env` with your Discord bot credentials:
```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_APPLICATION_ID=your_discord_application_id_here
DISCORD_GUILD_ID=your_test_guild_id_here  # Optional: for development

# Database Configuration
DATABASE_URL=postgresql://user:password@<host>:<db_port>/discord_bot

# Redis Configuration
REDIS_URL=redis://<host>:<redis_port>

# Lavalink Configuration
LAVALINK_HOST=<host>
LAVALINK_PORT=<lavalink_port>
LAVALINK_PASSWORD=youshallnotpass
```

### **3. Database Setup**
```bash
# Generate Prisma client
pnpm --filter @discord-bot/database prisma:generate

# Run database migrations
pnpm db:migrate

# Seed database with initial data
pnpm db:seed
```

### **4. Start Development**
```bash
# Quick start - Optimized music bot only
node start-music-bot.js

# OR: Full microservices development
pnpm dev:all
```

---

## 🏗️ **Architecture Options**

### **Option 1: Standalone Bot (Recommended for Development)**
**Best for**: Quick testing, feature development, production deployment

```bash
# Start the optimized bot
node music-bot-optimized.js
```

**Features**:
- ✅ All music functionality working
- ✅ Real-time progress tracking
- ✅ Interactive button controls
- ✅ Optimized for production scaling
- ✅ Single file deployment

### **Microservices Architecture** (Current Production Setup)
**Best for**: Production deployment, enterprise patterns, scalable development

```bash
# Start all services in development
pnpm dev:all

# Or start individual services
pnpm --filter gateway dev    # Discord interface
pnpm --filter audio dev      # Music processing + Lavalink
pnpm --filter worker dev     # Background jobs + BullMQ
pnpm --filter api dev        # REST endpoints + health checks
```

**Features**:
- ✅ **Production ready** with enterprise optimizations
- ✅ **Distributed architecture** with Redis pub/sub communication
- ✅ **Scalable design patterns** with independent service deployment
- ✅ **Advanced caching** with predictive and adaptive strategies
- ✅ **Background processing** with BullMQ enterprise job queues
- ✅ **Comprehensive monitoring** with health checks and metrics

---

## 📁 **Project Structure**

```
discord_bot/
├── 📱 Bot Implementations
│   ├── music-bot-optimized.js     # ✅ Production ready
│   ├── start-music-bot.js         # ✅ Launcher script
│   ├── music-bot-complete.js      # 🔧 Development version
│   └── simple-bot.js              # 🧪 Testing only
│
├── 🏗️ Microservices
│   ├── gateway/                   # Discord.js interface
│   │   └── src/                  # Current microservices implementation
│   ├── audio/                    # Lavalink integration
│   ├── api/                      # REST endpoints
│   └── worker/                   # Background jobs
│
├── 📦 Shared Packages
│   ├── packages/cache/           # Multi-layer caching
│   ├── packages/config/          # Environment config
│   ├── packages/database/        # Prisma ORM
│   ├── packages/logger/          # Structured logging
│   └── packages/commands/        # Command system
│
├── 🎵 External Services
│   ├── lavalink/                 # Audio server config
│   └── docker-compose.yml        # Full stack deployment
│
└── 📚 Documentation
    └── docs/                     # Comprehensive guides
```

---

## 🔧 **Development Workflow**

### **Daily Development Commands**
```bash
# Install new dependencies
pnpm add <package-name>                    # Root dependency
pnpm --filter gateway add <package-name>  # Service-specific
pnpm --filter @discord-bot/logger add <package-name>  # Package-specific

# Development
pnpm dev           # Start gateway service only
pnpm dev:all       # Start all microservices

# Code Quality
pnpm lint          # ESLint check
pnpm typecheck     # TypeScript validation
pnpm test          # Run test suite

# Building
pnpm build         # Build current directory
pnpm -r build      # Build all packages recursively

# Database Operations
pnpm db:migrate    # Run pending migrations
pnpm db:seed       # Seed test data
pnpm --filter @discord-bot/database prisma:studio  # Database GUI
```

### **Git Workflow**
```bash
# Feature development
git checkout -b feature/your-feature-name
git add .
git commit -m "feat: implement your feature"
git push origin feature/your-feature-name

# Create pull request through GitHub interface
```

### **Testing Workflow**
```bash
# Run all tests
pnpm test

# Run specific test files
pnpm test gateway/test/commands.test.ts
pnpm test packages/logger/test/health.test.ts

# Run tests in watch mode
pnpm test --watch

# Run tests with coverage
pnpm test --coverage
```

---

## 🧪 **Testing Strategy**

### **Test Categories**
- **Unit Tests**: Individual function testing
- **Integration Tests**: Service interaction testing
- **End-to-End Tests**: Full workflow testing
- **Performance Tests**: Load and stress testing

### **Test Configuration** (`vitest.config.ts`)
```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    alias: {
      '@discord-bot/database': path.resolve(__dirname, 'packages/database/src/index.ts'),
      '@discord-bot/logger': path.resolve(__dirname, 'packages/logger/src/index.ts'),
      '@discord-bot/config': path.resolve(__dirname, 'packages/config/src/index.ts'),
    }
  }
});
```

### **Writing Tests**
```typescript
// Example test file
import { describe, it, expect, beforeEach } from 'vitest';
import { MusicCommand } from '../src/commands/music-command';

describe('MusicCommand', () => {
  let command: MusicCommand;

  beforeEach(() => {
    command = new MusicCommand();
  });

  it('should parse YouTube URLs correctly', () => {
    const url = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    const result = command.parseUrl(url);
    expect(result.isValid).toBe(true);
    expect(result.platform).toBe('youtube');
  });

  it('should handle search queries', async () => {
    const query = 'Never Gonna Give You Up';
    const results = await command.search(query);
    expect(results).toHaveLength(10);
    expect(results[0]).toHaveProperty('title');
  });
});
```

### **Test Coverage Goals**
- **Overall**: 85%+ test coverage
- **Critical Paths**: 95%+ (music playback, command handling)
- **Utilities**: 90%+ (logging, caching, database)
- **UI Components**: 70%+ (Discord interface, embeds)

---

## 🐛 **Debugging Guide**

### **Development Debugging**

#### **Enable Debug Mode**
```bash
# Environment variable
DEBUG=discord-bot:* pnpm dev

# Or in code
process.env.DEBUG = 'discord-bot:*';
```

#### **Common Debug Points**
```typescript
// Command execution
console.log('Command received:', interaction.commandName, interaction.options.data);

// Lavalink connection
console.log('Lavalink node status:', node.connected, node.stats);

// Queue operations
console.log('Queue state:', player.queue.tracks.length, player.playing);

// Discord API responses
console.log('Discord response:', response.status, response.data);
```

### **Production Debugging**

#### **Health Checks**
```bash
# Service health
curl http://<host>:<gateway_port>/health  # Gateway
curl http://<host>:<audio_port>/health  # Audio
curl http://<host>:<api_port>/health  # API

# Lavalink status
curl http://<host>:<lavalink_port>/version
```

#### **Log Analysis**
```bash
# View recent logs
pm2 logs discord-music-bot --lines 100

# Follow logs in real-time
pm2 logs discord-music-bot --follow

# Search logs for errors
pm2 logs discord-music-bot | grep ERROR
```

### **Common Issues and Solutions**

#### **"Commands not registering"**
```bash
# Re-register commands
cd gateway && node scripts/register-commands.ts

# Check Discord application settings
# Verify bot permissions in Discord server
```

#### **"Bot not responding to commands"**
```typescript
// Check client ready state
console.log('Bot ready:', client.isReady());
console.log('Guild count:', client.guilds.cache.size);

// Verify command handlers
client.on('interactionCreate', (interaction) => {
  console.log('Interaction received:', interaction.type, interaction.commandName);
});
```

#### **"Music not playing"**
```bash
# Check Lavalink connectivity
curl http://<host>:<lavalink_port>/version

# Verify voice connection
# Check bot permissions in voice channel
# Test with different YouTube URLs
```

#### **"Progress bars not updating"**
```typescript
// Debug progress tracker
console.log('Active trackers:', progressTracker.activeTrackers.size);
console.log('Update interval:', interval, 'ms');
console.log('Track duration:', duration, 'ms');
```

---

## 🚀 **Deployment Guide**

### **Development Deployment**
```bash
# Local development with hot reload
pnpm dev:all

# Test production build locally
pnpm build
pnpm start
```

### **Staging Deployment**
```bash
# Build and test
pnpm build
pnpm test

# Deploy to staging environment
docker-compose -f docker-compose.staging.yml up -d

# Run integration tests
curl http://staging.example.com/health
```

### **Production Deployment**

#### **Option 1: Simple VPS**
```bash
# Production server setup
git clone <repository-url>
cd discord_bot

# Install dependencies
pnpm install --production

# Configure environment
cp .env.example .env.production
# Edit with production values

# Start with PM2
npm install -g pm2
pm2 start music-bot-optimized.js --name discord-bot
pm2 startup
pm2 save
```

#### **Option 2: Docker Production**
```bash
# Full microservices stack
docker-compose -f docker-compose.production.yml up -d

# Check service health
curl http://<host>:<gateway_port>/health
curl http://<host>:<audio_port>/health
curl http://<host>:<api_port>/health
```

#### **Option 3: Kubernetes**
```bash
# Deploy to Kubernetes cluster
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -l app=discord-bot

# View logs
kubectl logs -f deployment/discord-bot-gateway
```

### **Production Monitoring**
```bash
# Prometheus metrics
curl http://<host>:<gateway_port>/metrics

# Health endpoints
curl http://<host>:<gateway_port>/health

# Performance monitoring
pm2 monit

# Resource usage
docker stats discord-bot_gateway_1
```

---

## 📈 **Performance Optimization**

### **Development Performance**
```bash
# Profile memory usage
node --inspect music-bot-optimized.js

# Monitor performance
pnpm run perf:monitor

# Analyze bundle size
pnpm run build:analyze
```

### **Production Optimization**

#### **Lavalink Configuration**
```yaml
# lavalink/application.yml - High performance settings
server:
  undertow:
    io-threads: 4
    worker-threads: 400

lavalink:
  server:
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    youtubePlaylistLoadLimit: 6
    playerUpdateInterval: 5
    youtubeSearchEnabled: true
    soundcloudSearchEnabled: true
```

#### **Database Optimization**
```typescript
// Connection pooling
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  pool     = 10
}

// Query optimization
await prisma.queue.findMany({
  where: { guildId },
  include: { items: true },
  orderBy: { updatedAt: 'desc' },
  take: 50  // Limit results
});
```

#### **Caching Strategy**
```typescript
// Multi-layer caching
const cacheKey = `queue:${guildId}`;
let data = memoryCache.get(cacheKey);
if (!data) {
  data = await redisCache.get(cacheKey);
  if (!data) {
    data = await database.getQueue(guildId);
    await redisCache.set(cacheKey, data, 30); // 30s TTL
  }
  memoryCache.set(cacheKey, data, 10); // 10s TTL
}
```

---

## 🔒 **Security Best Practices**

### **Environment Security**
```bash
# Never commit .env files
echo ".env*" >> .gitignore

# Use environment-specific configs
.env.development
.env.staging
.env.production
```

### **Code Security**
```typescript
// Input validation
import { z } from 'zod';

const playCommandSchema = z.object({
  query: z.string().min(1).max(500),
  volume: z.number().min(0).max(200).optional()
});

// Sanitize user input
const sanitizedQuery = query.replace(/[<>\"'&]/g, '');

// Rate limiting
const rateLimiter = new Map();
if (rateLimiter.has(userId)) {
  return interaction.reply('Please wait before using this command again.');
}
rateLimiter.set(userId, Date.now());
```

### **Discord Security**
```typescript
// Permission checking
if (!interaction.member.permissions.has('CONNECT')) {
  return interaction.reply('Insufficient permissions.');
}

// Guild validation
if (!interaction.guild) {
  return interaction.reply('This command can only be used in servers.');
}
```

---

## 📊 **Code Quality Standards**

### **ESLint Configuration**
```json
{
  "extends": [
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/no-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "prefer-const": "error",
    "no-var": "error"
  }
}
```

### **TypeScript Standards**
```typescript
// Strict type checking
interface PlayCommandOptions {
  query: string;
  volume?: number;
  loop?: 'off' | 'track' | 'queue';
}

// Error handling
class MusicError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'MusicError';
  }
}

// Async/await best practices
async function playMusic(query: string): Promise<void> {
  try {
    const track = await searchTrack(query);
    await player.play(track);
  } catch (error) {
    logger.error('Failed to play music', { error, query });
    throw new MusicError('Failed to play track', 'PLAY_FAILED', true);
  }
}
```

### **Documentation Standards**
```typescript
/**
 * Plays a music track from a URL or search query
 * @param query - YouTube URL or search terms
 * @param options - Playback options
 * @returns Promise that resolves when track starts playing
 * @throws {MusicError} When track cannot be played
 */
async function playMusic(
  query: string,
  options?: PlayCommandOptions
): Promise<void> {
  // Implementation
}
```

---

## 🤝 **Contributing Guidelines**

### **Pull Request Process**
1. **Fork and Clone**: Create your own fork
2. **Feature Branch**: `git checkout -b feature/your-feature`
3. **Development**: Follow coding standards
4. **Testing**: Ensure all tests pass
5. **Documentation**: Update relevant docs
6. **Pull Request**: Create PR with clear description

### **Code Review Checklist**
- [ ] Follows TypeScript standards
- [ ] Includes appropriate tests
- [ ] Updates documentation
- [ ] Passes all CI checks
- [ ] No breaking changes without discussion
- [ ] Performance impact considered

### **Issue Reporting**
When reporting issues, include:
- Environment details (Node.js version, OS)
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or error messages
- Minimal reproduction example

---

This development guide provides everything needed to contribute effectively to the Discord music bot project. Start with the Quick Start section and follow the microservices architecture setup for development.