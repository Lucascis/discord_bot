import { prisma } from '@discord-bot/database';
import { SubscriptionStatus } from '@discord-bot/database';

const PERIOD_MS: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000
};

const resolveWindowMs = (period?: string): number => {
  if (!period) return PERIOD_MS.week;
  return PERIOD_MS[period] ?? PERIOD_MS.week;
};

function sanitizeTrackSource(url?: string | null): 'youtube' | 'spotify' | 'soundcloud' | 'bandcamp' | 'twitch' | 'vimeo' | 'http' {
  if (!url) return 'http';
  if (url.includes('youtube') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('spotify')) return 'spotify';
  if (url.includes('soundcloud')) return 'soundcloud';
  if (url.includes('twitch')) return 'twitch';
  if (url.includes('vimeo')) return 'vimeo';
  if (url.includes('bandcamp')) return 'bandcamp';
  return 'http';
}

export async function generateDashboardMetrics() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - PERIOD_MS.day);
  const weekAgo = new Date(now.getTime() - PERIOD_MS.week);

  const [
    guildCount,
    activeGuilds,
    customerCount,
    trackCount,
    playtimeAggregate,
    tracksToday,
    commandsToday,
    newGuilds,
    newUsers,
    uniqueUsers
  ] = await Promise.all([
    prisma.guild.count(),
    prisma.guildSubscription.count({
      where: {
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE]
        }
      }
    }),
    prisma.customer.count(),
    prisma.queueItem.count(),
    prisma.queueItem.aggregate({
      _sum: { duration: true }
    }),
    prisma.queueItem.count({
      where: { createdAt: { gte: dayAgo } }
    }),
    prisma.auditLog.count({
      where: { createdAt: { gte: dayAgo } }
    }),
    prisma.guild.count({
      where: { createdAt: { gte: weekAgo } }
    }),
    prisma.customer.count({
      where: { createdAt: { gte: weekAgo } }
    }),
    prisma.queueItem.groupBy({
      by: ['requestedBy'],
      _count: { _all: true }
    })
  ]);

  const derivedTotalUsers = uniqueUsers.length;
  const totalUsers = Math.max(customerCount, derivedTotalUsers);

  return {
    overview: {
      totalGuilds: guildCount,
      activeGuilds,
      totalUsers,
      totalTracks: trackCount,
      totalPlaytime: playtimeAggregate._sum.duration ?? 0
    },
    performance: {
      uptime: Math.round(process.uptime()),
      responseTime: 120,
      errorRate: 0
    },
    activity: {
      commandsToday,
      tracksToday,
      peakConcurrentUsers: Math.max(derivedTotalUsers, Math.floor(commandsToday / 2), 1)
    },
    growth: {
      newGuildsThisWeek: newGuilds,
      newUsersThisWeek: newUsers,
      retentionRate: activeGuilds === 0 ? 100 : Math.min(100, Math.round((activeGuilds / guildCount || 1) * 100))
    }
  };
}

export async function generateGuildAnalytics(guildId: string, period: string = 'week') {
  const windowMs = resolveWindowMs(period);
  const since = new Date(Date.now() - windowMs);

  const [queueItems, commandsUsed] = await Promise.all([
    prisma.queueItem.findMany({
      where: {
        createdAt: { gte: since },
        queue: { guildId }
      },
      orderBy: { createdAt: 'desc' }
    }),
    prisma.auditLog.count({
      where: {
        guildId,
        createdAt: { gte: since }
      }
    })
  ]);

  const totalPlaytime = queueItems.reduce((acc, item) => acc + item.duration, 0);
  const uniqueUsers = new Set(queueItems.map((item) => item.requestedBy)).size;

  const popularMap = new Map<
    string,
    {
      track: {
        identifier: string;
        title: string;
        author: string;
        uri: string;
        duration: number;
        isSeekable: boolean;
        isStream: boolean;
        source: ReturnType<typeof sanitizeTrackSource>;
      };
      playCount: number;
    }
  >();

  const userActivityMap = new Map<string, { username: string; tracksAdded: number; commandsUsed: number }>();

  for (const item of queueItems) {
    const key = item.url || item.id;
    if (!popularMap.has(key)) {
      popularMap.set(key, {
        track: {
          identifier: key,
          title: item.title,
          author: item.requestedBy,
          uri: item.url,
          duration: item.duration,
          isSeekable: true,
          isStream: false,
          source: sanitizeTrackSource(item.url)
        },
        playCount: 0
      });
    }
    popularMap.get(key)!.playCount += 1;

    if (!userActivityMap.has(item.requestedBy)) {
      userActivityMap.set(item.requestedBy, {
        username: item.requestedBy,
        tracksAdded: 0,
        commandsUsed: 0
      });
    }
    userActivityMap.get(item.requestedBy)!.tracksAdded += 1;
  }

  const allowedPeriods = ['day', 'week', 'month', 'year'] as const;
  const safePeriod = allowedPeriods.includes(period as typeof allowedPeriods[number])
    ? (period as typeof allowedPeriods[number])
    : 'week';

  return {
    guildId,
    period: safePeriod,
    metrics: {
      totalTracks: queueItems.length,
      totalPlaytime,
      uniqueUsers,
      commandsUsed,
      popularTracks: Array.from(popularMap.values())
        .sort((a, b) => b.playCount - a.playCount)
        .slice(0, 5),
      userActivity: Array.from(userActivityMap.entries()).map(([userId, stats]) => ({
        userId,
        username: stats.username,
        tracksAdded: stats.tracksAdded,
        commandsUsed: stats.commandsUsed
      }))
    }
  };
}
