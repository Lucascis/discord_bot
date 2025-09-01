import { logger } from '@discord-bot/logger';

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  try {
    const t = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));
    return (await Promise.race([p.catch((e) => { logger.error({ e, label }, 'op failed'); return undefined as unknown as T; }), t])) as T | undefined;
  } catch (e) {
    logger.error({ e, label }, 'op threw');
    return undefined;
  }
}

