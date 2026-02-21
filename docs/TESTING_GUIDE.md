# 🧪 Testing Guide

## Overview

Esta guía cubre la estrategia de testing para el Discord Music Bot, incluyendo tests unitarios, de integración y del sistema de capacidades avanzadas.

## 🚀 Quick Start

```bash
# Ejecutar todos los tests
pnpm test

# Ejecutar tests específicos del sistema de capacidades
npx vitest run packages/config/test/enhanced-tier-config.test.ts

# Ejecutar tests con coverage
pnpm test --coverage

# Ejecutar tests de un package específico
pnpm test gateway/test/

# Ejecutar tests en modo watch
pnpm test --watch
```

## 📁 Test Structure

```
tests/                         # Integration & E2E tests
├── gateway/                   # Gateway integration tests
├── audio-integration.test.ts  # Audio integration tests
├── e2e/                       # End-to-End tests
└── ...

gateway/test/                  # Gateway unit tests
audio/test/                    # Audio unit tests
api/test/                      # API unit tests
packages/*/test/               # Shared package tests
```

## 🧩 Test Categories

### Unit Tests
- **Domain Logic**: Entities, Value Objects, Domain Services
- **Use Cases**: Application layer business logic
- **Utilities**: Helper functions and utilities
- **Configuration**: Environment and feature configuration

### Integration Tests
- **Service Communication**: Inter-service messaging
- **Database Operations**: Prisma repositories
- **External APIs**: Lavalink, Discord API
- **Cache Operations**: Redis integration

### End-to-End Tests
- **Discord Commands**: Full command execution
- **Audio Playback**: Complete audio flow
- **Capacidades avanzadas**: Feature access and usage controls

## ✅ Sistema de capacidades avanzadas - Tests

### Feature Access Tests

```typescript
describe('Feature Access Control', () => {
  it('should allow free tier access to basic features', () => {
    expect(hasFeatureAccess('free', 'sponsor_block')).toBe(true);
  });

  it('should deny advanced features to free tier', () => {
    expect(hasFeatureAccess('free', 'spotify_integration')).toBe(false);
  });
});
```

### Quota Management Tests

```typescript
describe('Quota Management', () => {
  it('should validate quota usage correctly', () => {
    const result = validateUsageQuota('free', 'queueSize', 25);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(25);
  });

  it('should deny when quota exceeded', () => {
    const result = validateUsageQuota('free', 'queueSize', 55);
    expect(result.allowed).toBe(false);
  });
});
```

### Pricing Tests

```typescript
describe('Pricing Calculations', () => {
  it('should apply discounts for yearly cycle', () => {
    const monthly = calculatePriceWithPeriod('advanced', 'monthly');
    const yearly = calculatePriceWithPeriod('advanced', 'yearly');
    expect(yearly).toBeLessThan(monthly * 12);
  });
});
```

## 🎯 Test Coverage Goals

| Component | Current | Goal |
|-----------|---------|------|
| Domain Layer | 95% | 100% |
| Use Cases | 85% | 95% |
| Services | 80% | 90% |
| Sistema capacidades | 100% | 100% |
| Integration | 70% | 85% |

## 🔧 Testing Utilities

### Test Helpers

```typescript
// Test data factories
export const createMockSubscription = (tier: SubscriptionTier) => ({
  id: 'sub_123',
  userId: 'user_123',
  guildId: 'guild_123',
  tier,
  status: 'active',
  // ...other fields
});

// Mock services
export const createMockPremiumService = () => ({
  validateFeatureAccess: vi.fn(),
  useFeature: vi.fn(),
  getSubscriptionStatus: vi.fn(),
});
```

### Environment Setup

```typescript
// tests/setup.ts
import { beforeAll, afterAll } from 'vitest';

beforeAll(async () => {
  // Setup test database
  // Initialize mock services
  // Configure test environment
});

afterAll(async () => {
  // Cleanup test data
  // Close connections
});
```

## 🏃‍♂️ Running Specific Test Suites

### Tests de configuración de capacidades

```bash
# Ejecutar tests del sistema de capacidades
npx vitest run packages/config/test/enhanced-tier-config.test.ts

# Salida esperada:
# ✓ Enhanced Configuration (21 tests) 6ms
#   ✓ Feature Access Control (5 tests)
#   ✓ Feature Lists by Tier (2 tests)
#   ✓ Quota Management (3 tests)
#   ✓ Pricing Calculations (3 tests)
#   ✓ Feature Configuration Structure (3 tests)
#   ✓ Audio Quality Levels (1 test)
#   ✓ Business Logic Validation (4 tests)
```

### Service Tests

```bash
# Gateway service tests
pnpm test gateway/test/

# Audio service tests
pnpm test audio/test/

# Database package tests
pnpm test packages/database/test/
```

### Integration Tests

```bash
# Cache integration
pnpm test tests/cache-integration.test.ts

# Audio integration
pnpm test tests/audio-integration.test.ts

# Business metrics
pnpm test tests/business-metrics.test.ts
```

## 🚨 Common Testing Issues

### Services Not Running

Some integration tests require running services. Handle with:

```typescript
describe('Service Integration', () => {
  let serverAvailable = false;

  beforeAll(async () => {
    try {
      const response = await fetch('http://localhost:3002/health');
      serverAvailable = response.ok;
    } catch (error) {
      console.warn('Service not available for testing');
    }
  });

  it('should test service endpoint', async () => {
    if (!serverAvailable) {
      console.log('Skipping - service not available');
      return;
    }
    // Test implementation
  });
});
```

### Database Dependencies

For tests requiring database:

```typescript
import { PrismaClient } from '@discord-bot/database';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'sqlite:memory'
    }
  }
});
```

### Mock External Services

```typescript
// Mock Lavalink
vi.mock('../services/lavalink', () => ({
  LavalinkService: vi.fn().mockImplementation(() => ({
    search: vi.fn().mockResolvedValue([]),
    play: vi.fn().mockResolvedValue(true),
  }))
}));

// Mock Discord API
vi.mock('discord.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    login: vi.fn().mockResolvedValue(true),
    guilds: { cache: new Map() }
  }))
}));
```

## 📊 Test Results Analysis

### Current Status

```
Test Files  33 passed (35)
Tests       346 passed | 2 skipped (354)
Duration    36.08s

Tests de capacidades:
✓ Feature Access Control: 5/5 passed
✓ Quota Management: 3/3 passed
✓ Pricing Calculations: 3/3 passed
✓ Configuration Structure: 8/8 passed
✓ Business Logic: 2/2 passed
```

### Failed Tests Resolution

Current failing tests are related to monitoring endpoints that require running services:

1. **monitoring-endpoints.test.ts**: Health check endpoints
   - **Issue**: Services not running during test
   - **Solution**: Mock responses or skip when services unavailable

2. **business-metrics.test.ts**: Metrics endpoints
   - **Issue**: Expected engagement metrics not found
   - **Solution**: Update metric expectations or provide test data

## 🔍 Debugging Tests

### Verbose Output

```bash
# Run with detailed output
pnpm test --reporter=verbose

# Run specific test with logs
DEBUG=* pnpm test specific-test.test.ts
```

### Test Database

```bash
# Reset test database
pnpm db:reset --env test

# Run migrations for test
pnpm db:migrate --env test
```

## 📝 Writing New Tests

### Test Template

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Component Name', () => {
  beforeEach(() => {
    // Setup for each test
  });

  afterEach(() => {
    // Cleanup after each test
  });

  describe('Feature Group', () => {
    it('should do something specific', async () => {
      // Arrange
      const input = 'test-input';

      // Act
      const result = await functionUnderTest(input);

      // Assert
      expect(result).toBe('expected-output');
    });
  });
});
```

### Test Naming Convention

- **Descriptive**: `should return user subscription when valid ID provided`
- **Behavior-focused**: `should throw error when quota exceeded`
- **Specific**: `should calculate 15% discount for yearly cycle`

## 🎭 Mocking Guidelines

### When to Mock

- External APIs (Discord, Spotify, etc.)
- Database operations in unit tests
- Time-dependent operations
- Network requests

### When NOT to Mock

- Internal domain logic
- Configuration validation
- Simple utilities
- Integration test scenarios

## 🚀 CI/CD Integration

### GitHub Actions

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: pnpm install
      - run: pnpm test
      - run: pnpm test:config
```

### Pre-commit Hooks

```bash
# Install husky for pre-commit hooks
pnpm install --save-dev husky

# Add pre-commit test
npx husky add .husky/pre-commit "pnpm test:quick"
```

## 📚 Best Practices

### Test Organization
- ✅ Group related tests with `describe`
- ✅ Use descriptive test names
- ✅ Follow AAA pattern (Arrange, Act, Assert)
- ✅ Keep tests independent
- ✅ Test one thing at a time

### Performance
- ✅ Use `beforeAll` for expensive setup
- ✅ Clean up resources in `afterAll`
- ✅ Use mocks for external dependencies
- ✅ Parallel test execution where possible

### Maintainability
- ✅ Extract common test utilities
- ✅ Use factories for test data
- ✅ Document complex test scenarios
- ✅ Regular test cleanup and refactoring

---

📊 **Testing is a critical part of maintaining code quality and ensuring the system works reliably in production.**
# Main Stack Voice Validation (Docker-first)

Use the primary stack for release validation:

```bash
docker compose up -d --build
docker compose ps
```

Required env for real audio probe:

```env
DISCORD_PROBE_TOKEN=
DISCORD_TEST_GUILD_ID=
DISCORD_TEST_VOICE_CHANNEL_ID=
DISCORD_TEST_TEXT_CHANNEL_ID=
E2E_AUDIO_RMS_THRESHOLD=0.015
E2E_AUDIO_CONSECUTIVE_WINDOWS=8
```

Run full voice gate on the main stack:

```bash
pnpm test:voice:diag:main
pnpm test:e2e:audio:main
pnpm test:voice:release:main
```

Notas operativas:

- Los smoke scripts de panel/voz ya no dependen de `jq`; usan parsing JSON vía Node para mayor portabilidad (Windows + WSL).
- `test:voice:release:main` valida audibilidad real como señal principal. Si querés que falle también por errores de extractor YouTube en logs, activá:

```bash
VOICE_RELEASE_STRICT_YOUTUBE=true pnpm test:voice:release:main
```

Tail logs during Discord manual validation:

```bash
docker compose logs -f gateway audio lavalink api worker
```
