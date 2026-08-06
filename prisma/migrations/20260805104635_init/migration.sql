-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('exporter_owner', 'exporter_member', 'agent', 'ops_supervisor', 'ops_finance', 'admin');

-- CreateEnum
CREATE TYPE "IecStatus" AS ENUM ('unknown', 'not_started', 'pending', 'verified');

-- CreateEnum
CREATE TYPE "ReadinessStatus" AS ENUM ('not_started', 'in_progress', 'ready', 'blocked');

-- CreateEnum
CREATE TYPE "JourneyStage" AS ENUM ('onboarding', 'ready', 'market_selected', 'buyer_engaged', 'deal_locked', 'docs_cleared', 'shipped', 'payment_realized');

-- CreateEnum
CREATE TYPE "CertificationStatus" AS ENUM ('not_started', 'in_progress', 'held', 'expired', 'not_applicable');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('unverified', 'partially_verified', 'verified');

-- CreateEnum
CREATE TYPE "BuyerLeadStage" AS ENUM ('new', 'shortlisted', 'contacted', 'replied', 'interested', 'negotiation', 'disqualified', 'converted');

-- CreateEnum
CREATE TYPE "InterestLevel" AS ENUM ('unknown', 'low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "DisqualificationReason" AS ENUM ('no_response', 'not_importing_category', 'volume_too_small', 'price_mismatch', 'risk_flag', 'duplicate', 'other');

-- CreateEnum
CREATE TYPE "OutreachActivityType" AS ENUM ('call', 'email', 'message', 'meeting', 'note');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('qualifying', 'negotiating', 'terms_agreed', 'deal_locked', 'executing', 'shipped', 'closed_won', 'closed_lost', 'cancelled');

-- CreateEnum
CREATE TYPE "RiskState" AS ENUM ('normal', 'watch', 'at_risk', 'blocked');

-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('not_started', 'in_progress', 'waiting', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "SlaState" AS ENUM ('on_time', 'due_soon', 'overdue', 'escalated');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('exporter_visible', 'internal');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('exporter_org', 'buyer_lead', 'deal', 'document', 'shipment', 'payment');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('PI', 'CI', 'packing_list', 'shipping_bill_draft', 'COO_draft', 'declaration', 'insurance_declaration', 'other');

-- CreateEnum
CREATE TYPE "DocumentSource" AS ENUM ('generated', 'uploaded', 'imported');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('queued', 'processing', 'generated', 'failed');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('not_reviewed', 'agent_reviewed', 'changes_requested');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('not_required', 'pending', 'exporter_approved', 'rejected');

-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('not_applicable', 'draft', 'ready', 'filed', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('planning', 'booking', 'pickup', 'customs', 'loaded', 'in_transit', 'arrived', 'delivered', 'exception');

-- CreateEnum
CREATE TYPE "ShipmentMode" AS ENUM ('sea', 'air', 'courier', 'road', 'other');

-- CreateEnum
CREATE TYPE "ExceptionState" AS ENUM ('none', 'watch', 'blocked');

-- CreateEnum
CREATE TYPE "MilestoneState" AS ENUM ('pending', 'in_progress', 'complete', 'skipped', 'exception');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('not_due', 'due', 'partially_received', 'received', 'realized', 'overdue', 'disputed');

-- CreateEnum
CREATE TYPE "BrcStatus" AS ENUM ('not_applicable', 'pending', 'available', 'verified');

-- CreateEnum
CREATE TYPE "PaymentSource" AS ENUM ('exporter_update', 'AA', 'bank_partner', 'manual_ops');

-- CreateEnum
CREATE TYPE "InsuranceCaseStatus" AS ENUM ('not_started', 'quote_requested', 'quoted', 'bound', 'claim_open', 'claim_settled', 'declined');

-- CreateEnum
CREATE TYPE "DisputeType" AS ENUM ('payment', 'quality', 'logistics', 'document', 'LC', 'inspection', 'other');

-- CreateEnum
CREATE TYPE "DisputeSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('open', 'investigating', 'waiting_external', 'proposed_resolution', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('info', 'action_required', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('web', 'api', 'job', 'admin');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'processing', 'completed', 'partial', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('readiness_assessment', 'demand_discovery', 'buyer_discovery', 'document_generation', 'report_export');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('cha', 'freight', 'insurance', 'inspection', 'bank');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('active', 'suspended', 'offboarded');

-- CreateEnum
CREATE TYPE "CommitmentFeeStatus" AS ENUM ('not_due', 'due', 'paid', 'waived', 'refunded');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('active', 'ended');

-- CreateTable
CREATE TABLE "ExporterOrg" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT,
    "display_name" TEXT NOT NULL,
    "gstin" TEXT,
    "iec" "IecStatus" NOT NULL DEFAULT 'unknown',
    "iec_number" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "state" TEXT,
    "city" TEXT,
    "assigned_agent_id" TEXT,
    "readiness_status" "ReadinessStatus" NOT NULL DEFAULT 'not_started',
    "journey_stage" "JourneyStage" NOT NULL DEFAULT 'onboarding',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExporterOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "exporter_org_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAssignment" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "agent_user_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "AgentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hs_code" TEXT,
    "hs_code_source" TEXT NOT NULL DEFAULT 'unknown',
    "capacity_value" DECIMAL(18,4),
    "capacity_unit" TEXT,
    "moq_value" DECIMAL(18,4),
    "moq_unit" TEXT,
    "price_target_amount" DECIMAL(18,4),
    "price_target_currency" VARCHAR(3),
    "packaging" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCertification" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CertificationStatus" NOT NULL DEFAULT 'not_started',
    "evidence_ref" TEXT,
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessAssessment" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "score" INTEGER,
    "status" "ReadinessStatus" NOT NULL DEFAULT 'in_progress',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadinessAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT,
    "job_id" TEXT,
    "requested_by_id" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketAssessment" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "overall_score" INTEGER NOT NULL,
    "demand_score" INTEGER,
    "growth_score" INTEGER,
    "competition_score" INTEGER,
    "india_share" DECIMAL(6,3),
    "tariff_summary" JSONB,
    "certification_requirements" JSONB NOT NULL DEFAULT '[]',
    "logistics_summary" JSONB,
    "price_band_min" DECIMAL(18,4),
    "price_band_max" DECIMAL(18,4),
    "price_band_currency" VARCHAR(3),
    "rationale" TEXT,
    "agent_note" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "MarketAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "website" TEXT,
    "buyer_type" TEXT NOT NULL,
    "import_activity_summary" JSONB,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "risk_flags" JSONB NOT NULL DEFAULT '[]',
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerContact" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'unverified',
    "provenance" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerSourceEvidence" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_ref" TEXT,
    "summary" TEXT,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerSourceEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerShortlist" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "product_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerShortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLead" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "stage" "BuyerLeadStage" NOT NULL DEFAULT 'new',
    "assigned_agent_id" TEXT,
    "created_by_id" TEXT,
    "next_action" TEXT,
    "next_action_at" TIMESTAMP(3),
    "last_contact_at" TIMESTAMP(3),
    "interest_level" "InterestLevel" NOT NULL DEFAULT 'unknown',
    "disqualification_reason" "DisqualificationReason",
    "disqualification_reason_text" TEXT,
    "fit_score" INTEGER,
    "fit_score_basis" JSONB,
    "deal_id" TEXT,
    "source" TEXT NOT NULL DEFAULT 'buyer_discovery',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachActivity" (
    "id" TEXT NOT NULL,
    "buyer_lead_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "type" "OutreachActivityType" NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'internal',
    "outcome" TEXT,
    "summary" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "exporter_org_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "buyer_lead_id" TEXT,
    "product_id" TEXT,
    "stage" "DealStage" NOT NULL DEFAULT 'qualifying',
    "value_amount" DECIMAL(18,4),
    "value_currency" VARCHAR(3),
    "incoterm" TEXT,
    "incoterm_place" TEXT,
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "unit_price_amount" DECIMAL(18,4),
    "unit_price_currency" VARCHAR(3),
    "total_amount" DECIMAL(18,4),
    "total_currency" VARCHAR(3),
    "payment_terms" JSONB,
    "delivery_terms" JSONB,
    "risk_state" "RiskState" NOT NULL DEFAULT 'normal',
    "risk_reason" TEXT,
    "owner_agent_id" TEXT,
    "quoted_fee_policy" JSONB,
    "locked_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealSnapshot" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "buyer_id" TEXT NOT NULL,
    "buyer_legal_name" TEXT NOT NULL,
    "product_id" TEXT,
    "product_name" TEXT,
    "sku" TEXT,
    "quantity" DECIMAL(18,4),
    "unit" TEXT,
    "unit_price_amount" DECIMAL(18,4),
    "unit_price_currency" VARCHAR(3),
    "total_amount" DECIMAL(18,4),
    "total_currency" VARCHAR(3),
    "incoterm" TEXT,
    "incoterm_place" TEXT,
    "payment_terms" JSONB,
    "ship_window_start" TIMESTAMP(3),
    "ship_window_end" TIMESTAMP(3),
    "special_conditions" TEXT,
    "fee_policy" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "exporter_org_id" TEXT,
    "deal_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_user_id" TEXT,
    "owner_role" "UserRole" NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'not_started',
    "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
    "due_at" TIMESTAMP(3),
    "warning_at" TIMESTAMP(3),
    "sla_state" "SlaState" NOT NULL DEFAULT 'on_time',
    "escalated_at" TIMESTAMP(3),
    "blocked_reason" TEXT,
    "waiting_on" TEXT,
    "cancel_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "visibility" "Visibility" NOT NULL DEFAULT 'exporter_visible',
    "task_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "shipment_id" TEXT,
    "doc_type" "DocType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current_version" BOOLEAN NOT NULL DEFAULT true,
    "source" "DocumentSource" NOT NULL,
    "generation_status" "GenerationStatus" NOT NULL DEFAULT 'queued',
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'not_reviewed',
    "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'not_required',
    "filing_status" "FilingStatus" NOT NULL DEFAULT 'not_applicable',
    "generation_error" TEXT,
    "changes_requested_reason" TEXT,
    "rejection_reason" TEXT,
    "filing_reference" TEXT,
    "filed_at" TIMESTAMP(3),
    "file_ref" TEXT,
    "file_name" TEXT,
    "file_size_bytes" INTEGER,
    "mime_type" TEXT,
    "checksum" TEXT,
    "generated_from_snapshot_id" TEXT,
    "generation_inputs" JSONB,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_version" INTEGER,
    "approved_checksum" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'planning',
    "mode" "ShipmentMode",
    "origin" JSONB,
    "destination" JSONB,
    "incoterm" TEXT,
    "cha_partner_id" TEXT,
    "freight_partner_id" TEXT,
    "booking_ref" TEXT,
    "customs_ref" TEXT,
    "shipping_bill_no" TEXT,
    "exception_state" "ExceptionState" NOT NULL DEFAULT 'none',
    "exception_reason" TEXT,
    "exception_owner_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentMilestone" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "state" "MilestoneState" NOT NULL DEFAULT 'pending',
    "eta_at" TIMESTAMP(3),
    "actual_at" TIMESTAMP(3),
    "evidence_ref" TEXT,
    "sequence" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "type" "PartnerType" NOT NULL,
    "legal_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "country_code" VARCHAR(2) NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "partner_status" "PartnerStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "amount_received" DECIMAL(18,4),
    "payment_method" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'not_due',
    "due_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "realized_at" TIMESTAMP(3),
    "evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "brc_status" "BrcStatus" NOT NULL DEFAULT 'not_applicable',
    "source" "PaymentSource" NOT NULL DEFAULT 'exporter_update',
    "label" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceCase" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "shipment_id" TEXT,
    "status" "InsuranceCaseStatus" NOT NULL DEFAULT 'not_started',
    "provider_name" TEXT,
    "policy_ref" TEXT,
    "premium_amount" DECIMAL(18,4),
    "premium_currency" VARCHAR(3),
    "covered_amount" DECIMAL(18,4),
    "covered_currency" VARCHAR(3),
    "quote_requested_at" TIMESTAMP(3),
    "bound_at" TIMESTAMP(3),
    "claim_opened_at" TIMESTAMP(3),
    "claim_settled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsuranceCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "shipment_id" TEXT,
    "payment_id" TEXT,
    "document_id" TEXT,
    "type" "DisputeType" NOT NULL,
    "severity" "DisputeSeverity" NOT NULL DEFAULT 'medium',
    "status" "DisputeStatus" NOT NULL DEFAULT 'open',
    "owner_user_id" TEXT,
    "summary" TEXT NOT NULL,
    "resolution" TEXT,
    "accepted_at" TIMESTAMP(3),
    "sla_due_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "thread_key" TEXT NOT NULL,
    "deal_id" TEXT,
    "buyer_lead_id" TEXT,
    "exporter_org_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalNote" (
    "id" TEXT NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "scope_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "buyer_lead_id" TEXT,
    "dispute_id" TEXT,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL DEFAULT 'info',
    "object_type" TEXT,
    "object_id" TEXT,
    "deep_link" TEXT,
    "read_at" TIMESTAMP(3),
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "role" "UserRole",
    "action" TEXT NOT NULL,
    "object_type" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "exporter_org_id" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "before_summary" JSONB,
    "after_summary" JSONB,
    "correlation_id" TEXT NOT NULL,
    "source" "AuditSource" NOT NULL DEFAULT 'web',

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "exporter_org_id" TEXT,
    "requested_by_id" TEXT,
    "dedupe_key" TEXT,
    "idempotency_key" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error_code" TEXT,
    "error_message" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "target_type" TEXT,
    "target_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAttempt" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'processing',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "result" JSONB,

    CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeePolicy" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "commitment_fee_amount" DECIMAL(18,4) NOT NULL,
    "commitment_fee_currency" VARCHAR(3) NOT NULL,
    "commitment_fee_status" "CommitmentFeeStatus" NOT NULL DEFAULT 'not_due',
    "success_fee_rate" DECIMAL(6,4) NOT NULL,
    "small_shipment_threshold_amount" DECIMAL(18,4) NOT NULL,
    "small_shipment_threshold_currency" VARCHAR(3) NOT NULL,
    "small_shipment_rate" DECIMAL(6,4) NOT NULL,
    "small_shipment_flat_amount" DECIMAL(18,4) NOT NULL,
    "agent_share_rate" DECIMAL(6,4) NOT NULL,
    "minimum_shipment_amount" DECIMAL(18,4) NOT NULL,
    "minimum_shipment_currency" VARCHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExporterOrg_assigned_agent_id_idx" ON "ExporterOrg"("assigned_agent_id");

-- CreateIndex
CREATE INDEX "ExporterOrg_readiness_status_idx" ON "ExporterOrg"("readiness_status");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_exporter_org_id_idx" ON "User"("exporter_org_id");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "AgentAssignment_exporter_org_id_status_idx" ON "AgentAssignment"("exporter_org_id", "status");

-- CreateIndex
CREATE INDEX "AgentAssignment_agent_user_id_status_idx" ON "AgentAssignment"("agent_user_id", "status");

-- CreateIndex
CREATE INDEX "Product_exporter_org_id_idx" ON "Product"("exporter_org_id");

-- CreateIndex
CREATE INDEX "Product_hs_code_idx" ON "Product"("hs_code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCertification_product_id_code_key" ON "ProductCertification"("product_id", "code");

-- CreateIndex
CREATE INDEX "ReadinessAssessment_exporter_org_id_is_current_idx" ON "ReadinessAssessment"("exporter_org_id", "is_current");

-- CreateIndex
CREATE INDEX "DiscoveryRun_exporter_org_id_created_at_idx" ON "DiscoveryRun"("exporter_org_id", "created_at");

-- CreateIndex
CREATE INDEX "MarketAssessment_run_id_overall_score_idx" ON "MarketAssessment"("run_id", "overall_score");

-- CreateIndex
CREATE INDEX "MarketAssessment_product_id_country_code_idx" ON "MarketAssessment"("product_id", "country_code");

-- CreateIndex
CREATE INDEX "Buyer_country_code_idx" ON "Buyer"("country_code");

-- CreateIndex
CREATE INDEX "Buyer_buyer_type_idx" ON "Buyer"("buyer_type");

-- CreateIndex
CREATE INDEX "Buyer_verification_status_idx" ON "Buyer"("verification_status");

-- CreateIndex
CREATE INDEX "BuyerContact_buyer_id_idx" ON "BuyerContact"("buyer_id");

-- CreateIndex
CREATE INDEX "BuyerSourceEvidence_buyer_id_observed_at_idx" ON "BuyerSourceEvidence"("buyer_id", "observed_at");

-- CreateIndex
CREATE INDEX "BuyerShortlist_exporter_org_id_idx" ON "BuyerShortlist"("exporter_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerShortlist_exporter_org_id_buyer_id_product_id_key" ON "BuyerShortlist"("exporter_org_id", "buyer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLead_deal_id_key" ON "BuyerLead"("deal_id");

-- CreateIndex
CREATE INDEX "BuyerLead_exporter_org_id_stage_idx" ON "BuyerLead"("exporter_org_id", "stage");

-- CreateIndex
CREATE INDEX "BuyerLead_assigned_agent_id_stage_idx" ON "BuyerLead"("assigned_agent_id", "stage");

-- CreateIndex
CREATE INDEX "BuyerLead_next_action_at_idx" ON "BuyerLead"("next_action_at");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLead_exporter_org_id_product_id_buyer_id_key" ON "BuyerLead"("exporter_org_id", "product_id", "buyer_id");

-- CreateIndex
CREATE INDEX "OutreachActivity_buyer_lead_id_occurred_at_idx" ON "OutreachActivity"("buyer_lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "Deal_exporter_org_id_stage_idx" ON "Deal"("exporter_org_id", "stage");

-- CreateIndex
CREATE INDEX "Deal_owner_agent_id_stage_idx" ON "Deal"("owner_agent_id", "stage");

-- CreateIndex
CREATE INDEX "Deal_risk_state_idx" ON "Deal"("risk_state");

-- CreateIndex
CREATE UNIQUE INDEX "DealSnapshot_deal_id_version_key" ON "DealSnapshot"("deal_id", "version");

-- CreateIndex
CREATE INDEX "Task_exporter_org_id_state_due_at_idx" ON "Task"("exporter_org_id", "state", "due_at");

-- CreateIndex
CREATE INDEX "Task_owner_user_id_state_due_at_idx" ON "Task"("owner_user_id", "state", "due_at");

-- CreateIndex
CREATE INDEX "Task_deal_id_state_idx" ON "Task"("deal_id", "state");

-- CreateIndex
CREATE INDEX "Task_sla_state_idx" ON "Task"("sla_state");

-- CreateIndex
CREATE INDEX "Document_deal_id_doc_type_version_idx" ON "Document"("deal_id", "doc_type", "version");

-- CreateIndex
CREATE INDEX "Document_approval_status_idx" ON "Document"("approval_status");

-- CreateIndex
CREATE INDEX "Document_filing_status_idx" ON "Document"("filing_status");

-- CreateIndex
CREATE INDEX "Shipment_deal_id_idx" ON "Shipment"("deal_id");

-- CreateIndex
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");

-- CreateIndex
CREATE INDEX "Shipment_exception_state_idx" ON "Shipment"("exception_state");

-- CreateIndex
CREATE INDEX "ShipmentMilestone_shipment_id_sequence_idx" ON "ShipmentMilestone"("shipment_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentMilestone_shipment_id_code_key" ON "ShipmentMilestone"("shipment_id", "code");

-- CreateIndex
CREATE INDEX "Partner_type_partner_status_idx" ON "Partner"("type", "partner_status");

-- CreateIndex
CREATE INDEX "Payment_deal_id_sequence_idx" ON "Payment"("deal_id", "sequence");

-- CreateIndex
CREATE INDEX "Payment_status_due_at_idx" ON "Payment"("status", "due_at");

-- CreateIndex
CREATE INDEX "InsuranceCase_deal_id_idx" ON "InsuranceCase"("deal_id");

-- CreateIndex
CREATE INDEX "Dispute_status_severity_idx" ON "Dispute"("status", "severity");

-- CreateIndex
CREATE INDEX "Dispute_deal_id_idx" ON "Dispute"("deal_id");

-- CreateIndex
CREATE INDEX "Dispute_owner_user_id_status_idx" ON "Dispute"("owner_user_id", "status");

-- CreateIndex
CREATE INDEX "Message_thread_key_created_at_idx" ON "Message"("thread_key", "created_at");

-- CreateIndex
CREATE INDEX "Message_exporter_org_id_idx" ON "Message"("exporter_org_id");

-- CreateIndex
CREATE INDEX "InternalNote_scope_type_scope_id_idx" ON "InternalNote"("scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_read_at_created_at_idx" ON "Notification"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_user_id_dedupe_key_key" ON "Notification"("user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "AuditEvent_object_type_object_id_timestamp_idx" ON "AuditEvent"("object_type", "object_id", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_actor_user_id_timestamp_idx" ON "AuditEvent"("actor_user_id", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_exporter_org_id_timestamp_idx" ON "AuditEvent"("exporter_org_id", "timestamp");

-- CreateIndex
CREATE INDEX "AuditEvent_correlation_id_idx" ON "AuditEvent"("correlation_id");

-- CreateIndex
CREATE INDEX "Job_status_run_after_idx" ON "Job"("status", "run_after");

-- CreateIndex
CREATE INDEX "Job_exporter_org_id_type_status_idx" ON "Job"("exporter_org_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupe_key_key" ON "Job"("dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "Job_idempotency_key_key" ON "Job"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "JobAttempt_job_id_attempt_no_key" ON "JobAttempt"("job_id", "attempt_no");

-- CreateIndex
CREATE INDEX "ConfigSetting_key_is_active_idx" ON "ConfigSetting"("key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigSetting_key_version_key" ON "ConfigSetting"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FeePolicy_version_key" ON "FeePolicy"("version");

-- AddForeignKey
ALTER TABLE "ExporterOrg" ADD CONSTRAINT "ExporterOrg_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAssignment" ADD CONSTRAINT "AgentAssignment_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAssignment" ADD CONSTRAINT "AgentAssignment_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAssignment" ADD CONSTRAINT "AgentAssignment_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCertification" ADD CONSTRAINT "ProductCertification_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessAssessment" ADD CONSTRAINT "ReadinessAssessment_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "DiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketAssessment" ADD CONSTRAINT "MarketAssessment_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerContact" ADD CONSTRAINT "BuyerContact_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerSourceEvidence" ADD CONSTRAINT "BuyerSourceEvidence_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerShortlist" ADD CONSTRAINT "BuyerShortlist_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerShortlist" ADD CONSTRAINT "BuyerShortlist_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_assigned_agent_id_fkey" FOREIGN KEY ("assigned_agent_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachActivity" ADD CONSTRAINT "OutreachActivity_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachActivity" ADD CONSTRAINT "OutreachActivity_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_owner_agent_id_fkey" FOREIGN KEY ("owner_agent_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealSnapshot" ADD CONSTRAINT "DealSnapshot_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_exporter_org_id_fkey" FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_generated_from_snapshot_id_fkey" FOREIGN KEY ("generated_from_snapshot_id") REFERENCES "DealSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_cha_partner_id_fkey" FOREIGN KEY ("cha_partner_id") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_freight_partner_id_fkey" FOREIGN KEY ("freight_partner_id") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentMilestone" ADD CONSTRAINT "ShipmentMilestone_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceCase" ADD CONSTRAINT "InsuranceCase_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_buyer_lead_id_fkey" FOREIGN KEY ("buyer_lead_id") REFERENCES "BuyerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "Dispute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
