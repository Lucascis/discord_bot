-- CreateTable
CREATE TABLE "public"."guilds" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "discordGuildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "ownerId" TEXT,
    "isTestGuild" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."guild_subscriptions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "guildId" TEXT NOT NULL,
    "tier" "public"."SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "mercadopagoSubscriptionId" TEXT,
    "paypalSubscriptionId" TEXT,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),

    CONSTRAINT "guild_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guilds_discordGuildId_key" ON "public"."guilds"("discordGuildId");

-- CreateIndex
CREATE INDEX "guilds_discordGuildId_idx" ON "public"."guilds"("discordGuildId");

-- CreateIndex
CREATE INDEX "guilds_isTestGuild_idx" ON "public"."guilds"("isTestGuild");

-- CreateIndex
CREATE UNIQUE INDEX "guild_subscriptions_guildId_key" ON "public"."guild_subscriptions"("guildId");

-- CreateIndex
CREATE INDEX "guild_subscriptions_guildId_idx" ON "public"."guild_subscriptions"("guildId");

-- CreateIndex
CREATE INDEX "guild_subscriptions_tier_idx" ON "public"."guild_subscriptions"("tier");

-- CreateIndex
CREATE INDEX "guild_subscriptions_status_idx" ON "public"."guild_subscriptions"("status");

-- AddForeignKey
ALTER TABLE "public"."guild_subscriptions" ADD CONSTRAINT "guild_subscriptions_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "public"."guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
