import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export {
  TransactionManager,
  TransactionError,
  getTransactionManager,
  TransactionPatterns,
  type TransactionOptions,
  type TransactionMetrics
} from './transaction-manager.js';
