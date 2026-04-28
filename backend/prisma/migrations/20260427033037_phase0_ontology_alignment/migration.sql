-- CreateEnum
CREATE TYPE "AgentInvocationStatus" AS ENUM ('success', 'validation_failed', 'error');

-- CreateEnum
CREATE TYPE "AgentSkillKind" AS ENUM ('agentic', 'deterministic', 'integration');

-- AlterTable
ALTER TABLE "approvals" ADD COLUMN     "condition_resolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "condition_resolved_at" TIMESTAMP(3),
ADD COLUMN     "condition_resolved_by" TEXT;

-- AlterTable
ALTER TABLE "changes" ADD COLUMN     "maintenance_window_end" TIMESTAMP(3),
ADD COLUMN     "maintenance_window_start" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "manager_id" TEXT,
ADD COLUMN     "systems_owned" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "agent_invocations" (
    "id" TEXT NOT NULL,
    "audit_event_id" TEXT,
    "skill" TEXT NOT NULL,
    "kind" "AgentSkillKind" NOT NULL DEFAULT 'agentic',
    "model" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL,
    "tokens_out" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "status" "AgentInvocationStatus" NOT NULL,
    "error_message" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "freeze_windows" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "applies_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "freeze_windows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_invocations_audit_event_id_key" ON "agent_invocations"("audit_event_id");

-- CreateIndex
CREATE INDEX "agent_invocations_skill_idx" ON "agent_invocations"("skill");

-- CreateIndex
CREATE INDEX "agent_invocations_created_at_idx" ON "agent_invocations"("created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_invocations_actor_idx" ON "agent_invocations"("actor");

-- CreateIndex
CREATE INDEX "freeze_windows_starts_at_idx" ON "freeze_windows"("starts_at");

-- CreateIndex
CREATE INDEX "freeze_windows_ends_at_idx" ON "freeze_windows"("ends_at");

-- CreateIndex
CREATE INDEX "freeze_windows_is_active_idx" ON "freeze_windows"("is_active");

-- CreateIndex
CREATE INDEX "users_manager_id_idx" ON "users"("manager_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_audit_event_id_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
