-- CreateTable
CREATE TABLE "public"."ServerConfiguration" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'free',
    "subscriptionExpiresAt" TIMESTAMP(3),
    "spotifyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "appleMusicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "deezerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lyricsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sponsorBlockEnabled" BOOLEAN NOT NULL DEFAULT true,
    "advancedSearchEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maxAudioQuality" TEXT NOT NULL DEFAULT 'medium',
    "volumeLimit" INTEGER NOT NULL DEFAULT 200,
    "maxQueueSize" INTEGER NOT NULL DEFAULT 100,
    "maxSongDuration" INTEGER NOT NULL DEFAULT 3600,
    "allowExplicitContent" BOOLEAN NOT NULL DEFAULT true,
    "djRoleId" TEXT,
    "djOnlyMode" BOOLEAN NOT NULL DEFAULT false,
    "voteSkipEnabled" BOOLEAN NOT NULL DEFAULT true,
    "voteSkipThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "autoplayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoplayMode" TEXT NOT NULL DEFAULT 'similar',
    "autoplayQueueSize" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ChannelConfiguration" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "musicEnabled" BOOLEAN NOT NULL DEFAULT true,
    "playlistsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "spotifyEnabled" BOOLEAN,
    "appleMusicEnabled" BOOLEAN,
    "deezerEnabled" BOOLEAN,
    "lyricsEnabled" BOOLEAN,
    "sponsorBlockEnabled" BOOLEAN,
    "volumeLimit" INTEGER,
    "maxQueueSize" INTEGER,
    "maxSongDuration" INTEGER,
    "djOnlyMode" BOOLEAN,
    "allowExplicitContent" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "expiresAt" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "paymentMethod" TEXT,
    "monthlyPlayTime" INTEGER NOT NULL DEFAULT 0,
    "monthlyRequests" INTEGER NOT NULL DEFAULT 0,
    "premiumServers" INTEGER NOT NULL DEFAULT 0,
    "customBotEnabled" BOOLEAN NOT NULL DEFAULT false,
    "prioritySupport" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LyricsCache" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "lyrics" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "timedLyrics" BOOLEAN NOT NULL DEFAULT false,
    "lyricsData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LyricsCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlaybackHistory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "playedFully" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "playbackQuality" TEXT,
    "pluginsUsed" TEXT[],

    CONSTRAINT "PlaybackHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookSubscription" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerConfiguration_guildId_key" ON "public"."ServerConfiguration"("guildId");

-- CreateIndex
CREATE INDEX "ServerConfiguration_guildId_idx" ON "public"."ServerConfiguration"("guildId");

-- CreateIndex
CREATE INDEX "ServerConfiguration_subscriptionTier_idx" ON "public"."ServerConfiguration"("subscriptionTier");

-- CreateIndex
CREATE INDEX "ServerConfiguration_subscriptionExpiresAt_idx" ON "public"."ServerConfiguration"("subscriptionExpiresAt");

-- CreateIndex
CREATE INDEX "ChannelConfiguration_guildId_idx" ON "public"."ChannelConfiguration"("guildId");

-- CreateIndex
CREATE INDEX "ChannelConfiguration_channelId_idx" ON "public"."ChannelConfiguration"("channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConfiguration_guildId_channelId_key" ON "public"."ChannelConfiguration"("guildId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSubscription_userId_key" ON "public"."UserSubscription"("userId");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_idx" ON "public"."UserSubscription"("userId");

-- CreateIndex
CREATE INDEX "UserSubscription_tier_idx" ON "public"."UserSubscription"("tier");

-- CreateIndex
CREATE INDEX "UserSubscription_expiresAt_idx" ON "public"."UserSubscription"("expiresAt");

-- CreateIndex
CREATE INDEX "LyricsCache_title_artist_idx" ON "public"."LyricsCache"("title", "artist");

-- CreateIndex
CREATE INDEX "LyricsCache_expiresAt_idx" ON "public"."LyricsCache"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LyricsCache_trackId_key" ON "public"."LyricsCache"("trackId");

-- CreateIndex
CREATE INDEX "PlaybackHistory_guildId_idx" ON "public"."PlaybackHistory"("guildId");

-- CreateIndex
CREATE INDEX "PlaybackHistory_userId_idx" ON "public"."PlaybackHistory"("userId");

-- CreateIndex
CREATE INDEX "PlaybackHistory_guildId_playedAt_idx" ON "public"."PlaybackHistory"("guildId", "playedAt");

-- CreateIndex
CREATE INDEX "PlaybackHistory_source_idx" ON "public"."PlaybackHistory"("source");

-- CreateIndex
CREATE INDEX "WebhookSubscription_guildId_idx" ON "public"."WebhookSubscription"("guildId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_isActive_idx" ON "public"."WebhookSubscription"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSubscription_guildId_webhookUrl_key" ON "public"."WebhookSubscription"("guildId", "webhookUrl");

-- AddForeignKey
ALTER TABLE "public"."ChannelConfiguration" ADD CONSTRAINT "ChannelConfiguration_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "public"."ServerConfiguration"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
