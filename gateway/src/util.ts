import { logger } from '@discord-bot/logger';

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<T | undefined>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.error({ label, timeoutMs: ms }, 'op timed out');
      resolve(undefined);
    }, ms);
  });

  try {
    const result = await Promise.race([
      p.then(value => {
        clearTimeout(timeoutId);
        return value;
      }).catch(e => {
        clearTimeout(timeoutId);
        logger.error({ e, label }, 'op failed');
        return undefined;
      }),
      timeoutPromise
    ]);

    return result;
  } catch (e) {
    clearTimeout(timeoutId);
    logger.error({ e, label }, 'op threw');
    return undefined;
  }
}

