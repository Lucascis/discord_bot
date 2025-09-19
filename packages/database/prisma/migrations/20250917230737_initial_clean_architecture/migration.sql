-- CreateTable
CREATE TABLE "public"."EventStoreEvent" (
    "id" SERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateVersion" INTEGER NOT NULL,
    "eventData" TEXT NOT NULL,
    "metadata" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "globalPosition" SERIAL NOT NULL,

    CONSTRAINT "EventStoreEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EventStoreSnapshot" (
    "id" SERIAL NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventStoreEvent_eventId_key" ON "public"."EventStoreEvent"("eventId");

-- CreateIndex
CREATE INDEX "EventStoreEvent_aggregateId_aggregateType_idx" ON "public"."EventStoreEvent"("aggregateId", "aggregateType");

-- CreateIndex
CREATE INDEX "EventStoreEvent_aggregateId_aggregateType_aggregateVersion_idx" ON "public"."EventStoreEvent"("aggregateId", "aggregateType", "aggregateVersion");

-- CreateIndex
CREATE INDEX "EventStoreEvent_eventType_idx" ON "public"."EventStoreEvent"("eventType");

-- CreateIndex
CREATE INDEX "EventStoreEvent_timestamp_idx" ON "public"."EventStoreEvent"("timestamp");

-- CreateIndex
CREATE INDEX "EventStoreEvent_globalPosition_idx" ON "public"."EventStoreEvent"("globalPosition");

-- CreateIndex
CREATE UNIQUE INDEX "EventStoreEvent_aggregateId_aggregateType_aggregateVersion_key" ON "public"."EventStoreEvent"("aggregateId", "aggregateType", "aggregateVersion");

-- CreateIndex
CREATE INDEX "EventStoreSnapshot_aggregateType_idx" ON "public"."EventStoreSnapshot"("aggregateType");

-- CreateIndex
CREATE INDEX "EventStoreSnapshot_timestamp_idx" ON "public"."EventStoreSnapshot"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "EventStoreSnapshot_aggregateId_aggregateType_key" ON "public"."EventStoreSnapshot"("aggregateId", "aggregateType");
