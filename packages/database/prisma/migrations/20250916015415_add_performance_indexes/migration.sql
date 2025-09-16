-- CreateIndex
CREATE INDEX "AuditLog_guildId_idx" ON "public"."AuditLog"("guildId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "public"."AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "public"."AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "FeatureFlag_guildId_idx" ON "public"."FeatureFlag"("guildId");

-- CreateIndex
CREATE INDEX "FeatureFlag_name_idx" ON "public"."FeatureFlag"("name");

-- CreateIndex
CREATE INDEX "Queue_guildId_idx" ON "public"."Queue"("guildId");

-- CreateIndex
CREATE INDEX "Queue_guildId_createdAt_idx" ON "public"."Queue"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "Queue_voiceChannelId_idx" ON "public"."Queue"("voiceChannelId");

-- CreateIndex
CREATE INDEX "QueueItem_queueId_idx" ON "public"."QueueItem"("queueId");

-- CreateIndex
CREATE INDEX "QueueItem_queueId_createdAt_idx" ON "public"."QueueItem"("queueId", "createdAt");

-- CreateIndex
CREATE INDEX "QueueItem_url_idx" ON "public"."QueueItem"("url");

-- CreateIndex
CREATE INDEX "QueueItem_requestedBy_idx" ON "public"."QueueItem"("requestedBy");

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "public"."RateLimit"("expiresAt");
