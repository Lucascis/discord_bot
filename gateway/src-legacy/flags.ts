import { prisma } from '@discord-bot/database';

// Simple cache for feature flags (reduces database load)
const flagCache = new Map<string, { value: boolean; expires: number }>();
const CACHE_TTL = 300000; // 5 minutes

function getCachedFlag(key: string): boolean | undefined {
  const cached = flagCache.get(key);
  if (!cached) return undefined;
  
  if (Date.now() > cached.expires) {
    flagCache.delete(key);
    return undefined;
  }
  
  return cached.value;
}

function setCachedFlag(key: string, value: boolean): void {
  flagCache.set(key, { value, expires: Date.now() + CACHE_TTL });
}

// Export for testing purposes
export function clearFlagCache(): void {
  flagCache.clear();
}

export async function getAutomixEnabled(guildId: string): Promise<boolean> {
  const cacheKey = `autoplay:${guildId}`;
  
  // Check cache first
  const cached = getCachedFlag(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  
  // Try canonical key first
  const auto = await prisma.featureFlag.findUnique({ 
    where: { guildId_name: { guildId, name: 'autoplay' } },
    select: { enabled: true }
  }).catch(() => null);
  
  if (auto) {
    const result = !!auto.enabled;
    setCachedFlag(cacheKey, result);
    return result;
  }
  
  // Legacy support: automix
  const legacy = await prisma.featureFlag.findUnique({ 
    where: { guildId_name: { guildId, name: 'automix' } },
    select: { enabled: true }
  }).catch(() => null);
  
  const result = !!legacy?.enabled;
  setCachedFlag(cacheKey, result);
  return result;
}

export async function setAutomixEnabled(guildId: string, enabled: boolean): Promise<void> {
  const cacheKey = `autoplay:${guildId}`;
  
  // If legacy exists, migrate to 'autoplay'
  const legacy = await prisma.featureFlag.findUnique({ where: { guildId_name: { guildId, name: 'automix' } }, select: { id: true } }).catch(() => null);
  if (legacy) {
    await prisma.featureFlag.update({ where: { id: legacy.id }, data: { enabled, name: 'autoplay' } });
    // Invalidate cache after update
    flagCache.delete(cacheKey);
    return;
  }
  const current = await prisma.featureFlag.findUnique({ where: { guildId_name: { guildId, name: 'autoplay' } }, select: { id: true } }).catch(() => null);
  if (current) {
    await prisma.featureFlag.update({ where: { id: current.id }, data: { enabled } });
  } else {
    await prisma.featureFlag.create({ data: { guildId, name: 'autoplay', enabled } });
  }
  
  // Invalidate cache after update
  flagCache.delete(cacheKey);
}

