-- CreateEnum
CREATE TYPE "public"."SubscriptionTier" AS ENUM ('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'UNPAID');

-- CreateEnum
CREATE TYPE "public"."BillingCycle" AS ENUM ('MONTHLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "public"."FeatureCategory" AS ENUM ('PLAYBACK', 'AUDIO_QUALITY', 'COMMANDS', 'SUPPORT', 'ANALYTICS', 'CUSTOMIZATION', 'LIMITS');

-- CreateEnum
CREATE TYPE "public"."FeatureType" AS ENUM ('BOOLEAN', 'NUMERIC', 'STRING');

-- CreateEnum
CREATE TYPE "public"."ResetPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "public"."SubscriptionEventType" AS ENUM ('CREATED', 'UPGRADED', 'DOWNGRADED', 'RENEWED', 'CANCELED', 'EXPIRED', 'PAYMENT_FAILED', 'PAYMENT_SUCCEEDED', 'TRIAL_STARTED', 'TRIAL_ENDED');

-- CreateTable
CREATE TABLE "public"."Subscription" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tier" "public"."SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCycle" "public"."BillingCycle",
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "isTrialing" BOOLEAN NOT NULL DEFAULT false,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Invoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "amountDue" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "stripeInvoiceId" TEXT,
    "paymentIntentId" TEXT,
    "paymentMethod" TEXT,
    "dueDate" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "description" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Feature" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "public"."FeatureCategory" NOT NULL,
    "type" "public"."FeatureType" NOT NULL,
    "availableInFree" BOOLEAN NOT NULL DEFAULT false,
    "availableInBasic" BOOLEAN NOT NULL DEFAULT false,
    "availableInPremium" BOOLEAN NOT NULL DEFAULT false,
    "availableInEnterprise" BOOLEAN NOT NULL DEFAULT true,
    "freeValue" TEXT,
    "basicValue" TEXT,
    "premiumValue" TEXT,
    "enterpriseValue" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageLimit" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "limitType" TEXT NOT NULL,
    "maxValue" INTEGER NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "resetPeriod" "public"."ResetPeriod",
    "lastReset" TIMESTAMP(3),
    "nextReset" TIMESTAMP(3),
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsageTracking" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "tracksPlayed" INTEGER NOT NULL DEFAULT 0,
    "playbackMinutes" INTEGER NOT NULL DEFAULT 0,
    "apiRequests" INTEGER NOT NULL DEFAULT 0,
    "activeGuilds" INTEGER NOT NULL DEFAULT 0,
    "totalTracksPlayed" INTEGER NOT NULL DEFAULT 0,
    "totalPlaybackMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalApiRequests" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "lastActivity" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageTracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "eventType" "public"."SubscriptionEventType" NOT NULL,
    "tier" "public"."SubscriptionTier",
    "previousTier" "public"."SubscriptionTier",
    "description" TEXT,
    "metadata" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_guildId_key" ON "public"."Subscription"("guildId");

-- CreateIndex
CREATE INDEX "Subscription_guildId_idx" ON "public"."Subscription"("guildId");

-- CreateIndex
CREATE INDEX "Subscription_tier_idx" ON "public"."Subscription"("tier");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "public"."Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "public"."Subscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Subscription_stripeSubscriptionId_idx" ON "public"."Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_currentPeriodEnd_idx" ON "public"."Subscription"("currentPeriodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "public"."Invoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "public"."Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_subscriptionId_idx" ON "public"."Invoice"("subscriptionId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "public"."Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_stripeInvoiceId_idx" ON "public"."Invoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "Invoice_periodStart_periodEnd_idx" ON "public"."Invoice"("periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "Feature_key_key" ON "public"."Feature"("key");

-- CreateIndex
CREATE INDEX "Feature_key_idx" ON "public"."Feature"("key");

-- CreateIndex
CREATE INDEX "Feature_category_idx" ON "public"."Feature"("category");

-- CreateIndex
CREATE INDEX "Feature_isActive_idx" ON "public"."Feature"("isActive");

-- CreateIndex
CREATE INDEX "UsageLimit_subscriptionId_idx" ON "public"."UsageLimit"("subscriptionId");

-- CreateIndex
CREATE INDEX "UsageLimit_limitType_idx" ON "public"."UsageLimit"("limitType");

-- CreateIndex
CREATE INDEX "UsageLimit_nextReset_idx" ON "public"."UsageLimit"("nextReset");

-- CreateIndex
CREATE UNIQUE INDEX "UsageLimit_subscriptionId_limitType_key" ON "public"."UsageLimit"("subscriptionId", "limitType");

-- CreateIndex
CREATE UNIQUE INDEX "UsageTracking_subscriptionId_key" ON "public"."UsageTracking"("subscriptionId");

-- CreateIndex
CREATE INDEX "UsageTracking_subscriptionId_idx" ON "public"."UsageTracking"("subscriptionId");

-- CreateIndex
CREATE INDEX "UsageTracking_currentPeriodEnd_idx" ON "public"."UsageTracking"("currentPeriodEnd");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_guildId_idx" ON "public"."SubscriptionEvent"("guildId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_eventType_idx" ON "public"."SubscriptionEvent"("eventType");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_createdAt_idx" ON "public"."SubscriptionEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Invoice" ADD CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsageLimit" ADD CONSTRAINT "UsageLimit_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsageTracking" ADD CONSTRAINT "UsageTracking_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

