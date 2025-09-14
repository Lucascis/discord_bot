import { logger } from '@discord-bot/logger';

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  try {
    const timeoutPromise = new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), ms)
    );
    const result = await Promise.race([
      p.catch((e) => {
        logger.error({ e, label }, 'op failed');
        return undefined as unknown as T;
      }),
      timeoutPromise
    ]);
    return result;
  } catch (e) {
    logger.error({ e, label }, 'op threw');
    return undefined;
  }
}

