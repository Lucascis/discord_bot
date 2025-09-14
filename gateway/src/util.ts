import { logger } from '@discord-bot/logger';

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  let isSettled = false;

  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutHandle = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        logger.error({ label, timeoutMs: ms }, 'op timed out');
        resolve(undefined);
      }
    }, ms);
  });

  const wrappedPromise = p.then(
    (value: T) => {
      if (!isSettled) {
        isSettled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        return value;
      }
      return undefined as T;
    },
    (error: unknown) => {
      if (!isSettled) {
        isSettled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        logger.error({ e: error, label }, 'op failed');
      }
      return undefined as T;
    }
  );

  try {
    const result = await Promise.race([wrappedPromise, timeoutPromise]);

    if (!isSettled) {
      isSettled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }

    return result as T | undefined;
  } catch (e) {
    if (!isSettled) {
      isSettled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      logger.error({ e, label }, 'op threw');
    }
    return undefined;
  }
}

