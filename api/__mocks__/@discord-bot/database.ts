import { vi } from 'vitest';

// Mock Prisma client for testing
export const prisma = {
  serverConfiguration: {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(null),
  },
  webhookSubscription: {
    upsert: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
  },
  subscription: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  $connect: vi.fn().mockResolvedValue(undefined),
  $disconnect: vi.fn().mockResolvedValue(undefined),
};
