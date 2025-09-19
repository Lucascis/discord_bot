/**
 * Infrastructure implementation for logging
 * This is a temporary console logger - in production use structured logging service
 */

export interface Logger {
  info(message: string | object, ...args: unknown[]): void;
  warn(message: string | object, ...args: unknown[]): void;
  error(message: string | object, ...args: unknown[]): void;
  debug(message: string | object, ...args: unknown[]): void;
}

class ConsoleLogger implements Logger {
  private readonly serviceName = 'gateway';

  info(message: string | object, ...args: unknown[]): void {
    if (typeof message === 'string') {
      console.log(`[INFO] [${this.serviceName}] ${message}`, ...args);
    } else {
      console.log(`[INFO] [${this.serviceName}]`, message, ...args);
    }
  }

  warn(message: string | object, ...args: unknown[]): void {
    if (typeof message === 'string') {
      console.warn(`[WARN] [${this.serviceName}] ${message}`, ...args);
    } else {
      console.warn(`[WARN] [${this.serviceName}]`, message, ...args);
    }
  }

  error(message: string | object, ...args: unknown[]): void {
    if (typeof message === 'string') {
      console.error(`[ERROR] [${this.serviceName}] ${message}`, ...args);
    } else {
      console.error(`[ERROR] [${this.serviceName}]`, message, ...args);
    }
  }

  debug(message: string | object, ...args: unknown[]): void {
    if (process.env.NODE_ENV === 'development' || process.env.LOG_LEVEL === 'debug') {
      if (typeof message === 'string') {
        console.debug(`[DEBUG] [${this.serviceName}] ${message}`, ...args);
      } else {
        console.debug(`[DEBUG] [${this.serviceName}]`, message, ...args);
      }
    }
  }
}

export const logger = new ConsoleLogger();