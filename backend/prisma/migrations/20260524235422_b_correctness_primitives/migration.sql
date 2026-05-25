-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "sequence" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL,
    "response_body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idempotency_records_created_at_idx" ON "idempotency_records"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_user_id_key_key" ON "idempotency_records"("user_id", "key");

-- CreateIndex
CREATE INDEX "audit_events_sequence_idx" ON "audit_events"("sequence" DESC);
