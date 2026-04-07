-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "ApprovalState" AS ENUM ('approved', 'pending', 'denied', 'not_required');

-- CreateEnum
CREATE TYPE "PolicyDecision" AS ENUM ('allow', 'deny', 'escalate', 'simulate_only');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('open', 'in_review', 'approved', 'blocked', 'escalated', 'deployed', 'rolled_back');

-- CreateEnum
CREATE TYPE "CIStatus" AS ENUM ('passing', 'failing', 'pending');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('sev1', 'sev2', 'sev3', 'sev4');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('new_incident', 'investigating', 'identified', 'monitoring', 'resolved');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'denied', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "EntitlementCheck" AS ENUM ('eligible', 'ineligible', 'review_required');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('change', 'access', 'remediation', 'escalation');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'denied', 'approved_with_condition');

-- CreateEnum
CREATE TYPE "CoApprovalStatus" AS ENUM ('approved', 'pending', 'denied');

-- CreateEnum
CREATE TYPE "AuditObjectType" AS ENUM ('change', 'incident', 'access', 'policy', 'execution', 'approval');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('success', 'blocked', 'escalated', 'denied');

-- CreateEnum
CREATE TYPE "RecommendationClass" AS ENUM ('required_now', 'recommended', 'optional_optimization', 'out_of_scope');

-- CreateEnum
CREATE TYPE "BlastRadiusType" AS ENUM ('service', 'database', 'api', 'queue', 'job', 'monitoring', 'integration');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('operator', 'engineer', 'it_support', 'approver', 'access_approver', 'admin');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "team" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changes" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "owner_team" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "status" "ChangeStatus" NOT NULL,
    "approval_state" "ApprovalState" NOT NULL,
    "policy_decision" "PolicyDecision" NOT NULL,
    "linked_prs" TEXT[],
    "ci_status" "CIStatus" NOT NULL,
    "maintenance_window" TEXT,
    "rollback_plan" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blast_radius_items" (
    "id" TEXT NOT NULL,
    "change_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "BlastRadiusType" NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "criticality" "RiskLevel" NOT NULL,
    "owner_team" TEXT NOT NULL,
    "details" TEXT NOT NULL,

    CONSTRAINT "blast_radius_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendations" (
    "id" TEXT NOT NULL,
    "change_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "classification" "RecommendationClass" NOT NULL,
    "expected_benefit" TEXT NOT NULL,
    "required_approvals" TEXT[],
    "executable_now" BOOLEAN NOT NULL,
    "draft_only" BOOLEAN NOT NULL,

    CONSTRAINT "recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "affected_service" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL,
    "assignment_group" TEXT NOT NULL,
    "related_ci" TEXT[],
    "related_changes" TEXT[],
    "likely_issue_type" TEXT NOT NULL,
    "root_cause_category" TEXT NOT NULL,
    "recommended_fix" TEXT NOT NULL,
    "kb_articles" TEXT[],
    "is_recurring" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "requester_email" TEXT NOT NULL,
    "requested_system" TEXT NOT NULL,
    "requested_role" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "manager" TEXT NOT NULL,
    "system_owner" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "policy_decision" "PolicyDecision" NOT NULL,
    "entitlement_check" "EntitlementCheck" NOT NULL,
    "auto_grant_allowed" BOOLEAN NOT NULL,
    "manager_approval_required" BOOLEAN NOT NULL,
    "owner_approval_required" BOOLEAN NOT NULL,
    "manager_approval" "ApprovalState" NOT NULL,
    "owner_approval" "ApprovalState" NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "title" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "impacted_system" TEXT NOT NULL,
    "risk_level" "RiskLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "condition" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linked_object_id" TEXT NOT NULL,
    "why_you_are_required" TEXT,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "co_approvals" (
    "id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CoApprovalStatus" NOT NULL,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "co_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_impacts" (
    "id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "approve" TEXT NOT NULL,
    "deny" TEXT NOT NULL,
    "escalate" TEXT NOT NULL,

    CONSTRAINT "decision_impacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "object_type" "AuditObjectType" NOT NULL,
    "object_id" TEXT NOT NULL,
    "object_title" TEXT NOT NULL,
    "policy_rule" TEXT,
    "result" "AuditResult" NOT NULL,
    "details" TEXT NOT NULL,
    "change_id" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bundle" TEXT NOT NULL,
    "decision" "PolicyDecision" NOT NULL,
    "scope" TEXT NOT NULL,
    "applies_to" TEXT[],
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "changes_ticket_id_key" ON "changes"("ticket_id");

-- CreateIndex
CREATE INDEX "changes_status_idx" ON "changes"("status");

-- CreateIndex
CREATE INDEX "changes_risk_level_idx" ON "changes"("risk_level");

-- CreateIndex
CREATE INDEX "changes_service_idx" ON "changes"("service");

-- CreateIndex
CREATE INDEX "blast_radius_items_change_id_idx" ON "blast_radius_items"("change_id");

-- CreateIndex
CREATE INDEX "recommendations_change_id_idx" ON "recommendations"("change_id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_incident_id_key" ON "incidents"("incident_id");

-- CreateIndex
CREATE INDEX "incidents_severity_idx" ON "incidents"("severity");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "access_requests_request_id_key" ON "access_requests"("request_id");

-- CreateIndex
CREATE INDEX "access_requests_status_idx" ON "access_requests"("status");

-- CreateIndex
CREATE INDEX "access_requests_risk_level_idx" ON "access_requests"("risk_level");

-- CreateIndex
CREATE INDEX "approvals_status_idx" ON "approvals"("status");

-- CreateIndex
CREATE INDEX "approvals_type_idx" ON "approvals"("type");

-- CreateIndex
CREATE INDEX "co_approvals_approval_id_idx" ON "co_approvals"("approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "decision_impacts_approval_id_key" ON "decision_impacts"("approval_id");

-- CreateIndex
CREATE INDEX "audit_events_object_type_object_id_idx" ON "audit_events"("object_type", "object_id");

-- CreateIndex
CREATE INDEX "audit_events_timestamp_idx" ON "audit_events"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_events_actor_idx" ON "audit_events"("actor");

-- CreateIndex
CREATE UNIQUE INDEX "policy_rules_name_key" ON "policy_rules"("name");

-- AddForeignKey
ALTER TABLE "blast_radius_items" ADD CONSTRAINT "blast_radius_items_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "co_approvals" ADD CONSTRAINT "co_approvals_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_impacts" ADD CONSTRAINT "decision_impacts_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_change_id_fkey" FOREIGN KEY ("change_id") REFERENCES "changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
