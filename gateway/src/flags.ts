import { prisma } from '@discord-bot/database';

export async function getAutomixEnabled(guildId: string): Promise<boolean> {
  // Try canonical key first
  const auto = await prisma.featureFlag.findUnique({ where: { guildId_name: { guildId, name: 'autoplay' } } }).catch(() => null);
  if (auto) return !!auto.enabled;
  // Legacy support: automix
  const legacy = await prisma.featureFlag.findUnique({ where: { guildId_name: { guildId, name: 'automix' } } }).catch(() => null);
  return !!legacy?.enabled;
}

export async function setAutomixEnabled(guildId: string, enabled: boolean): Promise<void> {
  // If legacy exists, migrate to 'autoplay'
  const legacy = await prisma.featureFlag.findUnique({ where: { guildId_name: { guildId, name: 'automix' } }, select: { id: true } }).catch(() => null);
  if (legacy) {
    await prisma.featureFlag.update({ where: { id: legacy.id }, data: { enabled, name: 'autoplay' } });
    return;
  }
  const current = await prisma.featureFlag.findUnique({ where: { guildId_name: { guildId, name: 'autoplay' } }, select: { id: true } }).catch(() => null);
  if (current) {
    await prisma.featureFlag.update({ where: { id: current.id }, data: { enabled } });
  } else {
    await prisma.featureFlag.create({ data: { guildId, name: 'autoplay', enabled } });
  }
}

