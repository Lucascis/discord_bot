import { BaseQuery } from '@discord-bot/cqrs';

/**
 * Get Music Session Query
 */
export class GetMusicSessionQuery extends BaseQuery {
  constructor(
    public readonly guildId: string,
    metadata: any = {}
  ) {
    super('GetMusicSession', {
      guildId,
      ...metadata
    });
  }
}

/**
 * Get Queue Query
 */
export class GetQueueQuery extends BaseQuery {
  constructor(
    public readonly guildId: string,
    public readonly limit?: number,
    public readonly offset?: number,
    metadata: any = {}
  ) {
    super('GetQueue', {
      guildId,
      ...metadata
    });
  }
}

/**
 * Get Guild Settings Query
 */
export class GetGuildSettingsQuery extends BaseQuery {
  constructor(
    public readonly guildId: string,
    metadata: any = {}
  ) {
    super('GetGuildSettings', {
      guildId,
      ...metadata
    });
  }
}

/**
 * Search Tracks Query
 */
export class SearchTracksQuery extends BaseQuery {
  constructor(
    public readonly query: string,
    public readonly guildId: string,
    public readonly limit?: number,
    metadata: any = {}
  ) {
    super('SearchTracks', {
      guildId,
      ...metadata
    });
  }
}

/**
 * Get Music Session History Query
 */
export class GetMusicSessionHistoryQuery extends BaseQuery {
  constructor(
    public readonly guildId: string,
    public readonly fromDate?: Date,
    public readonly toDate?: Date,
    public readonly limit?: number,
    metadata: any = {}
  ) {
    super('GetMusicSessionHistory', {
      guildId,
      ...metadata
    });
  }
}

/**
 * Get User Music Stats Query
 */
export class GetUserMusicStatsQuery extends BaseQuery {
  constructor(
    public readonly userId: string,
    public readonly guildId?: string,
    public readonly period?: 'day' | 'week' | 'month' | 'year',
    metadata: any = {}
  ) {
    super('GetUserMusicStats', {
      userId,
      guildId,
      ...metadata
    });
  }
}

/**
 * Get Guild Music Analytics Query
 */
export class GetGuildMusicAnalyticsQuery extends BaseQuery {
  constructor(
    public readonly guildId: string,
    public readonly period?: 'day' | 'week' | 'month' | 'year',
    metadata: any = {}
  ) {
    super('GetGuildMusicAnalytics', {
      guildId,
      ...metadata
    });
  }
}

/**
 * Get Most Popular Tracks Query
 */
export class GetMostPopularTracksQuery extends BaseQuery {
  constructor(
    public readonly guildId?: string,
    public readonly period?: 'day' | 'week' | 'month' | 'year',
    public readonly limit?: number,
    metadata: any = {}
  ) {
    super('GetMostPopularTracks', {
      guildId,
      ...metadata
    });
  }
}