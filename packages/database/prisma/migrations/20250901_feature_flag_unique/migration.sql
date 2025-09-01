-- Deduplicate any existing rows per (guildId, name) keeping one arbitrarily
DELETE FROM "FeatureFlag" a
USING "FeatureFlag" b
WHERE a."guildId" = b."guildId"
  AND a."name" = b."name"
  AND a.ctid < b.ctid;

-- Add unique index on (guildId, name)
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureFlag_guildId_name_key" ON "FeatureFlag"("guildId", "name");
