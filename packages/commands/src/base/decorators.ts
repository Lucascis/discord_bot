import 'reflect-metadata';
import { type CommandPermissions, type CommandRateLimit } from './command.js';

const METADATA_KEYS = {
  PERMISSIONS: Symbol('permissions'),
  RATE_LIMIT: Symbol('rateLimit'),
  CATEGORY: Symbol('category'),
  ENABLED: Symbol('enabled'),
} as const;

// Type for class constructor
type Constructor = new (...args: unknown[]) => object;

/**
 * Decorator to set command permissions
 */
export function Permissions(permissions: CommandPermissions) {
  return function <T extends Constructor>(target: T) {
    Reflect.defineMetadata(METADATA_KEYS.PERMISSIONS, permissions, target);
    return target;
  };
}

/**
 * Decorator to set command rate limits
 */
export function RateLimit(limit: number, windowSeconds: number = 60) {
  return function <T extends Constructor>(target: T) {
    const rateLimit: CommandRateLimit = { limit, windowSeconds };
    Reflect.defineMetadata(METADATA_KEYS.RATE_LIMIT, rateLimit, target);
    return target;
  };
}

/**
 * Decorator to set command category
 */
export function Category(category: string) {
  return function <T extends Constructor>(target: T) {
    Reflect.defineMetadata(METADATA_KEYS.CATEGORY, category, target);
    return target;
  };
}

/**
 * Decorator to enable/disable command
 */
export function Enabled(enabled: boolean = true) {
  return function <T extends Constructor>(target: T) {
    Reflect.defineMetadata(METADATA_KEYS.ENABLED, enabled, target);
    return target;
  };
}

/**
 * Shorthand decorators for common permission patterns
 */
export const RequiresDJ = () => Permissions({ requiresDjRole: true });
export const RequiresAdmin = () => Permissions({ requiresAdmin: true });
export const RequiresVoice = () => Permissions({ requiresVoiceChannel: true });
export const DmAllowed = () => Permissions({ guildOnly: false });

/**
 * Utility function to get metadata from command classes
 */
export function getCommandMetadata(target: Constructor): {
  permissions?: CommandPermissions;
  rateLimit?: CommandRateLimit;
  category?: string;
  enabled?: boolean;
} {
  return {
    permissions: Reflect.getMetadata(METADATA_KEYS.PERMISSIONS, target),
    rateLimit: Reflect.getMetadata(METADATA_KEYS.RATE_LIMIT, target),
    category: Reflect.getMetadata(METADATA_KEYS.CATEGORY, target),
    enabled: Reflect.getMetadata(METADATA_KEYS.ENABLED, target),
  };
}

// Interface for objects with metadata
interface WithMetadata {
  metadata?: { name?: string };
}

/**
 * Method decorator for command execution logging
 */
export function LogExecution(_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;
  
  descriptor.value = async function (this: WithMetadata, ...args: unknown[]) {
    const startTime = Date.now();
    
    try {
      const result = await originalMethod.apply(this, args);
      const executionTime = Date.now() - startTime;
      
      console.log(`Command ${this?.metadata?.name || 'unknown'} executed in ${executionTime}ms`);
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      console.error(`Command ${this?.metadata?.name || 'unknown'} failed after ${executionTime}ms:`, error);
      throw error;
    }
  };
  
  return descriptor;
}
