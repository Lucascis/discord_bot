# API Test Setup Instructions

## Problem
The API routes instantiate Redis clients at module load time (before tests run), which prevents vi.mock() from setup.ts from working.

## Solution
Each test file must include vi.mock('ioredis') BEFORE importing the app. The mock will be hoisted and applied before any imports.

## Usage Pattern
```typescript
import { vi } from 'vitest';

// Mock Redis BEFORE importing app - this gets hoisted
vi.mock('ioredis', () => ({
  default: class MockRedis {
    // Mock implementation
  }
}));

// Now import app - Redis is already mocked
import { app } from '../src/app.js';
```

## Global Helpers
The setup.ts file provides:
- `setMockRedisResponse(requestType, response)` - Set mock response for a request type  
- `clearMockRedisResponses()` - Clear all mock responses

These are automatically cleared in beforeEach().
