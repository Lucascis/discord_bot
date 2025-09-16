import { logger } from '@discord-bot/logger';

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let isResolved = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        logger.error({ label, timeoutMs: ms }, 'op timed out');
        resolve(undefined);
      }
    }, ms);

    // Handle the original promise
    p.then(
      (value: T) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          logger.error({ e: error, label }, 'op failed');
          resolve(undefined);
        }
      }
    );
  });
}

