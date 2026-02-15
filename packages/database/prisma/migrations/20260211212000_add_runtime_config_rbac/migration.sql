-- Create enums for runtime configuration and admin RBAC
CREATE TYPE "AdminRole" AS ENUM ('SUPERADMIN', 'READ_ONLY');
CREATE TYPE "RuntimeConfigScope" AS ENUM ('GLOBAL', 'GUILD', 'MIXED');
CREATE TYPE "RuntimeConfigValueType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'JSON');
CREATE TYPE "RuntimeConfigSensitivity" AS ENUM ('PUBLIC', 'RESTRICTED', 'SECRET_REF');
CREATE TYPE "RuntimePlanTier" AS ENUM ('FREE', 'BASIC', 'PREMIUM', 'ENTERPRISE');
CREATE TYPE "ConfigActorRole" AS ENUM ('SUPERADMIN', 'GUILD_ADMIN', 'READ_ONLY', 'SYSTEM');

-- Create admin users table
CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL DEFAULT 'READ_ONLY',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_discordUserId_key" ON "AdminUser"("discordUserId");
CREATE INDEX "AdminUser_discordUserId_active_idx" ON "AdminUser"("discordUserId", "active");
CREATE INDEX "AdminUser_role_idx" ON "AdminUser"("role");

-- Create runtime configuration definition catalog
CREATE TABLE "RuntimeConfigDefinition" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "scope" "RuntimeConfigScope" NOT NULL,
  "valueType" "RuntimeConfigValueType" NOT NULL,
  "sensitivity" "RuntimeConfigSensitivity" NOT NULL DEFAULT 'PUBLIC',
  "planMinTier" "RuntimePlanTier" NOT NULL DEFAULT 'FREE',
  "mutable" BOOLEAN NOT NULL DEFAULT true,
  "hotReload" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT,
  "validationSchema" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuntimeConfigDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RuntimeConfigDefinition_key_key" ON "RuntimeConfigDefinition"("key");
CREATE INDEX "RuntimeConfigDefinition_scope_idx" ON "RuntimeConfigDefinition"("scope");
CREATE INDEX "RuntimeConfigDefinition_mutable_idx" ON "RuntimeConfigDefinition"("mutable");
CREATE INDEX "RuntimeConfigDefinition_hotReload_idx" ON "RuntimeConfigDefinition"("hotReload");

-- Create global runtime values
CREATE TABLE "RuntimeConfigValue" (
  "id" TEXT NOT NULL,
  "definitionKey" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RuntimeConfigValue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RuntimeConfigValue_definitionKey_key" ON "RuntimeConfigValue"("definitionKey");
CREATE INDEX "RuntimeConfigValue_updatedAt_idx" ON "RuntimeConfigValue"("updatedAt");

-- Create guild overrides
CREATE TABLE "GuildRuntimeConfigOverride" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "definitionKey" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuildRuntimeConfigOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildRuntimeConfigOverride_guildId_definitionKey_key" ON "GuildRuntimeConfigOverride"("guildId", "definitionKey");
CREATE INDEX "GuildRuntimeConfigOverride_guildId_idx" ON "GuildRuntimeConfigOverride"("guildId");
CREATE INDEX "GuildRuntimeConfigOverride_definitionKey_idx" ON "GuildRuntimeConfigOverride"("definitionKey");
CREATE INDEX "GuildRuntimeConfigOverride_updatedAt_idx" ON "GuildRuntimeConfigOverride"("updatedAt");

-- Create config audit log
CREATE TABLE "ConfigAuditLog" (
  "id" TEXT NOT NULL,
  "actorDiscordUserId" TEXT,
  "actorRole" "ConfigActorRole" NOT NULL,
  "scope" "RuntimeConfigScope" NOT NULL,
  "guildId" TEXT,
  "key" TEXT NOT NULL,
  "oldValueHash" TEXT,
  "newValueHash" TEXT,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfigAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConfigAuditLog_key_createdAt_idx" ON "ConfigAuditLog"("key", "createdAt");
CREATE INDEX "ConfigAuditLog_guildId_createdAt_idx" ON "ConfigAuditLog"("guildId", "createdAt");
CREATE INDEX "ConfigAuditLog_actorDiscordUserId_createdAt_idx" ON "ConfigAuditLog"("actorDiscordUserId", "createdAt");

-- Foreign keys
ALTER TABLE "RuntimeConfigValue"
  ADD CONSTRAINT "RuntimeConfigValue_definitionKey_fkey"
  FOREIGN KEY ("definitionKey") REFERENCES "RuntimeConfigDefinition"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuildRuntimeConfigOverride"
  ADD CONSTRAINT "GuildRuntimeConfigOverride_definitionKey_fkey"
  FOREIGN KEY ("definitionKey") REFERENCES "RuntimeConfigDefinition"("key")
  ON DELETE CASCADE ON UPDATE CASCADE;
