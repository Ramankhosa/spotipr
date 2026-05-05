-- ============================================================================
-- Schema drift reconciliation migration (idempotent)
-- All statements use IF EXISTS / IF NOT EXISTS to safely handle
-- objects that may already exist from prior db push usage.
-- ============================================================================

-- DropForeignKey (safe: only if exists)
DO $$ BEGIN
    ALTER TABLE "service_completion_usage" DROP CONSTRAINT "service_completion_usage_tenantId_fkey";
EXCEPTION WHEN undefined_object OR undefined_table THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "service_completion_usage" DROP CONSTRAINT "service_completion_usage_userId_fkey";
EXCEPTION WHEN undefined_object OR undefined_table THEN null;
END $$;

-- DropIndex (safe: IF EXISTS)
DROP INDEX IF EXISTS "diagram_sources_sessionId_figureNo_key";
DROP INDEX IF EXISTS "drafting_sessions_patent_type_primary_idx";
DROP INDEX IF EXISTS "service_completion_usage_operationId_idx";
DROP INDEX IF EXISTS "service_completion_usage_serviceType_isCompleted_idx";
DROP INDEX IF EXISTS "service_completion_usage_tenantId_idx";
DROP INDEX IF EXISTS "service_completion_usage_userId_idx";
DROP INDEX IF EXISTS "user_section_instructions_session_id_jurisdiction_idx";
DROP INDEX IF EXISTS "user_section_instructions_session_id_section_key_key";

-- AlterTable: admin_discounts
DO $$ BEGIN
    ALTER TABLE "admin_discounts" ALTER COLUMN "applicablePlans" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;
DO $$ BEGIN
    ALTER TABLE "admin_discounts" ALTER COLUMN "restrictedToUserIds" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;
DO $$ BEGIN
    ALTER TABLE "admin_discounts" ALTER COLUMN "restrictedToEmails" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;

-- AlterTable: annexure_drafts
ALTER TABLE "annexure_drafts" ADD COLUMN IF NOT EXISTS "extraSections" JSONB DEFAULT '{}';

-- AlterTable: diagram_sources
ALTER TABLE "diagram_sources" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "diagram_sources" ADD COLUMN IF NOT EXISTS "originalImageFilename" TEXT;
ALTER TABLE "diagram_sources" ADD COLUMN IF NOT EXISTS "originalImagePath" TEXT;
ALTER TABLE "diagram_sources" ADD COLUMN IF NOT EXISTS "translatedFromDiagramId" TEXT;

-- AlterTable: drafting_sessions
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "figureSequence" JSONB;
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "figure_sequence_finalized" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "is_multi_jurisdiction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "reference_draft_complete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drafting_sessions" ADD COLUMN IF NOT EXISTS "reference_draft_id" TEXT;

-- AlterTable: email_draft_attachments
DO $$ BEGIN
    ALTER TABLE "email_draft_attachments" ALTER COLUMN "updatedAt" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;

-- AlterTable: email_draft_requests
DO $$ BEGIN
    ALTER TABLE "email_draft_requests" ALTER COLUMN "updatedAt" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;

-- AlterTable: teams
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: tenant_feature_overrides
DO $$ BEGIN
    ALTER TABLE "tenant_feature_overrides" ALTER COLUMN "updatedAt" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;

-- AlterTable: tenant_inbound_aliases
DO $$ BEGIN
    ALTER TABLE "tenant_inbound_aliases" ALTER COLUMN "updatedAt" DROP DEFAULT;
EXCEPTION WHEN undefined_table OR undefined_column THEN null;
END $$;

-- AlterTable: trial_email_templates (drop column + add column)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trial_email_templates' AND column_name='createdBy') THEN
        ALTER TABLE "trial_email_templates" DROP COLUMN "createdBy";
    END IF;
END $$;
ALTER TABLE "trial_email_templates" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: trial_unsubscribes (drop column + add columns)
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trial_unsubscribes' AND column_name='unsubscribedAt') THEN
        ALTER TABLE "trial_unsubscribes" DROP COLUMN "unsubscribedAt";
    END IF;
END $$;
ALTER TABLE "trial_unsubscribes" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "trial_unsubscribes" ADD COLUMN IF NOT EXISTS "reason" TEXT;

-- ============================================================================
-- CreateTable statements (all IF NOT EXISTS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "llm_models" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "contextWindow" INTEGER NOT NULL DEFAULT 128000,
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsStreaming" BOOLEAN NOT NULL DEFAULT true,
    "inputCostPer1M" INTEGER NOT NULL DEFAULT 0,
    "outputCostPer1M" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "llm_models_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "workflow_stages" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "featureCode" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "workflow_stages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_stage_model_configs" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackModelIds" TEXT,
    "maxTokensIn" INTEGER,
    "maxTokensOut" INTEGER,
    "temperature" DOUBLE PRECISION DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plan_stage_model_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_task_model_configs" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "taskCode" "TaskCode" NOT NULL,
    "modelId" TEXT NOT NULL,
    "fallbackModelIds" TEXT,
    "maxTokensIn" INTEGER,
    "maxTokensOut" INTEGER,
    "temperature" DOUBLE PRECISION DEFAULT 0.7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plan_task_model_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "patent_drafting_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hasDescription" BOOLEAN NOT NULL DEFAULT false,
    "hasClaims" BOOLEAN NOT NULL DEFAULT false,
    "isCounted" BOOLEAN NOT NULL DEFAULT false,
    "countedMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "countedAt" TIMESTAMP(3),
    CONSTRAINT "patent_drafting_usage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ai_review_results" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "draft_id" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokens_used" INTEGER,
    "appliedFixes" JSONB NOT NULL DEFAULT '[]',
    "ignoredIssues" JSONB NOT NULL DEFAULT '[]',
    "userFeedback" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_review_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_section_validations" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "max_words" INTEGER,
    "min_words" INTEGER,
    "recommended_words" INTEGER,
    "max_chars" INTEGER,
    "min_chars" INTEGER,
    "recommended_chars" INTEGER,
    "max_count" INTEGER,
    "max_independent" INTEGER,
    "count_before_extra_fee" INTEGER,
    "word_limit_severity" TEXT,
    "char_limit_severity" TEXT,
    "count_limit_severity" TEXT,
    "word_limit_message" TEXT,
    "char_limit_message" TEXT,
    "count_limit_message" TEXT,
    "legal_reference" TEXT,
    "additional_rules" JSONB DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_section_validations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_cross_validations" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "check_type" TEXT NOT NULL,
    "from_section" TEXT NOT NULL,
    "to_sections" TEXT[],
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "review_prompt" TEXT,
    "legal_basis" TEXT,
    "check_params" JSONB DEFAULT '{}',
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_cross_validations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_diagram_configs" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "required_when_applicable" BOOLEAN NOT NULL DEFAULT true,
    "supported_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "figure_label_format" TEXT NOT NULL DEFAULT 'Fig. {number}',
    "auto_reference_table" BOOLEAN NOT NULL DEFAULT true,
    "paper_size" TEXT NOT NULL DEFAULT 'A4',
    "color_allowed" BOOLEAN NOT NULL DEFAULT false,
    "color_usage_note" TEXT,
    "line_style" TEXT NOT NULL DEFAULT 'black_and_white_solid',
    "ref_numerals_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "min_ref_text_size_pt" INTEGER NOT NULL DEFAULT 8,
    "drawing_margin_top_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "drawing_margin_bottom_cm" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "drawing_margin_left_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "drawing_margin_right_cm" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "default_diagram_count" INTEGER NOT NULL DEFAULT 4,
    "max_diagrams_recommended" INTEGER NOT NULL DEFAULT 10,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_diagram_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_diagram_hints" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "diagram_type" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "preferred_syntax" TEXT,
    "example_code" TEXT,
    "max_elements" INTEGER,
    "require_labels" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_diagram_hints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_export_configs" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "page_size" TEXT NOT NULL DEFAULT 'A4',
    "margin_top_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_bottom_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "margin_left_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "margin_right_cm" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "font_family" TEXT NOT NULL DEFAULT 'Times New Roman',
    "font_size_pt" INTEGER NOT NULL DEFAULT 12,
    "line_spacing" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "heading_font_family" TEXT,
    "heading_font_size_pt" INTEGER,
    "add_page_numbers" BOOLEAN NOT NULL DEFAULT true,
    "add_paragraph_numbers" BOOLEAN NOT NULL DEFAULT false,
    "page_number_format" TEXT NOT NULL DEFAULT 'Page {page} of {total}',
    "page_number_position" TEXT NOT NULL DEFAULT 'header-right',
    "includes_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "section_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "export_options" JSONB DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "CountrySectionPromptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_export_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_export_headings" (
    "id" TEXT NOT NULL,
    "export_config_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "style" TEXT NOT NULL DEFAULT 'uppercase',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "country_export_headings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_validation_overrides" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "section_key" TEXT NOT NULL,
    "custom_max_words" INTEGER,
    "custom_max_chars" INTEGER,
    "custom_max_count" INTEGER,
    "custom_severity" TEXT,
    "override_reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_validation_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "country_config_imports" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "import_type" TEXT NOT NULL,
    "source_json" JSONB NOT NULL,
    "source_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_skipped" INTEGER NOT NULL DEFAULT 0,
    "error_log" JSONB,
    "previous_state" JSONB,
    "rolled_back_at" TIMESTAMP(3),
    "rolled_back_by" TEXT,
    "imported_by" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "country_config_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_pricing" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "priceUSD" INTEGER NOT NULL,
    "priceINR" INTEGER NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "yearlyDiscountMonths" INTEGER NOT NULL DEFAULT 1,
    "razorpayPlanIdUSD" TEXT,
    "razorpayPlanIdINR" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "plan_pricing_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- CreateIndex (all IF NOT EXISTS)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "llm_models_code_key" ON "llm_models"("code");

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_stages_code_key" ON "workflow_stages"("code");

CREATE INDEX IF NOT EXISTS "plan_stage_model_configs_planId_idx" ON "plan_stage_model_configs"("planId");
CREATE INDEX IF NOT EXISTS "plan_stage_model_configs_stageId_idx" ON "plan_stage_model_configs"("stageId");
CREATE UNIQUE INDEX IF NOT EXISTS "plan_stage_model_configs_planId_stageId_key" ON "plan_stage_model_configs"("planId", "stageId");

CREATE UNIQUE INDEX IF NOT EXISTS "plan_task_model_configs_planId_taskCode_key" ON "plan_task_model_configs"("planId", "taskCode");

CREATE UNIQUE INDEX IF NOT EXISTS "patent_drafting_usage_sessionId_key" ON "patent_drafting_usage"("sessionId");
CREATE INDEX IF NOT EXISTS "patent_drafting_usage_tenantId_countedAt_idx" ON "patent_drafting_usage"("tenantId", "countedAt");
CREATE INDEX IF NOT EXISTS "patent_drafting_usage_tenantId_countedMonth_idx" ON "patent_drafting_usage"("tenantId", "countedMonth");
CREATE INDEX IF NOT EXISTS "patent_drafting_usage_sessionId_idx" ON "patent_drafting_usage"("sessionId");

CREATE INDEX IF NOT EXISTS "ai_review_results_session_id_jurisdiction_idx" ON "ai_review_results"("session_id", "jurisdiction");
CREATE INDEX IF NOT EXISTS "ai_review_results_draft_id_idx" ON "ai_review_results"("draft_id");

CREATE INDEX IF NOT EXISTS "country_section_validations_country_code_idx" ON "country_section_validations"("country_code");
CREATE INDEX IF NOT EXISTS "country_section_validations_section_key_idx" ON "country_section_validations"("section_key");
CREATE UNIQUE INDEX IF NOT EXISTS "country_section_validations_country_code_section_key_key" ON "country_section_validations"("country_code", "section_key");

CREATE INDEX IF NOT EXISTS "country_cross_validations_country_code_idx" ON "country_cross_validations"("country_code");
CREATE INDEX IF NOT EXISTS "country_cross_validations_check_type_idx" ON "country_cross_validations"("check_type");
CREATE UNIQUE INDEX IF NOT EXISTS "country_cross_validations_country_code_check_id_key" ON "country_cross_validations"("country_code", "check_id");

CREATE UNIQUE INDEX IF NOT EXISTS "country_diagram_configs_country_code_key" ON "country_diagram_configs"("country_code");
CREATE INDEX IF NOT EXISTS "country_diagram_configs_country_code_idx" ON "country_diagram_configs"("country_code");

CREATE INDEX IF NOT EXISTS "country_diagram_hints_config_id_idx" ON "country_diagram_hints"("config_id");
CREATE UNIQUE INDEX IF NOT EXISTS "country_diagram_hints_config_id_diagram_type_key" ON "country_diagram_hints"("config_id", "diagram_type");

CREATE INDEX IF NOT EXISTS "country_export_configs_country_code_idx" ON "country_export_configs"("country_code");
CREATE UNIQUE INDEX IF NOT EXISTS "country_export_configs_country_code_document_type_id_key" ON "country_export_configs"("country_code", "document_type_id");

CREATE INDEX IF NOT EXISTS "country_export_headings_export_config_id_idx" ON "country_export_headings"("export_config_id");
CREATE UNIQUE INDEX IF NOT EXISTS "country_export_headings_export_config_id_section_key_key" ON "country_export_headings"("export_config_id", "section_key");

CREATE INDEX IF NOT EXISTS "user_validation_overrides_session_id_idx" ON "user_validation_overrides"("session_id");
CREATE INDEX IF NOT EXISTS "user_validation_overrides_user_id_idx" ON "user_validation_overrides"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "user_validation_overrides_session_id_jurisdiction_section_k_key" ON "user_validation_overrides"("session_id", "jurisdiction", "section_key");

CREATE INDEX IF NOT EXISTS "country_config_imports_country_code_idx" ON "country_config_imports"("country_code");
CREATE INDEX IF NOT EXISTS "country_config_imports_status_idx" ON "country_config_imports"("status");
CREATE INDEX IF NOT EXISTS "country_config_imports_imported_by_idx" ON "country_config_imports"("imported_by");

CREATE INDEX IF NOT EXISTS "plan_pricing_planCode_idx" ON "plan_pricing"("planCode");
CREATE INDEX IF NOT EXISTS "plan_pricing_isActive_idx" ON "plan_pricing"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "plan_pricing_planId_billingCycle_key" ON "plan_pricing"("planId", "billingCycle");

CREATE INDEX IF NOT EXISTS "diagram_sources_sessionId_language_idx" ON "diagram_sources"("sessionId", "language");
CREATE UNIQUE INDEX IF NOT EXISTS "diagram_sources_sessionId_figureNo_language_key" ON "diagram_sources"("sessionId", "figureNo", "language");

CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_patentId_key" ON "email_draft_requests"("patentId");
CREATE UNIQUE INDEX IF NOT EXISTS "email_draft_requests_sessionId_key" ON "email_draft_requests"("sessionId");

CREATE INDEX IF NOT EXISTS "service_completion_usage_tenantId_serviceType_completionDat_idx" ON "service_completion_usage"("tenantId", "serviceType", "completionDate");
CREATE INDEX IF NOT EXISTS "service_completion_usage_tenantId_serviceType_completionMon_idx" ON "service_completion_usage"("tenantId", "serviceType", "completionMonth");
CREATE INDEX IF NOT EXISTS "service_completion_usage_userId_serviceType_idx" ON "service_completion_usage"("userId", "serviceType");
CREATE UNIQUE INDEX IF NOT EXISTS "service_completion_usage_tenantId_serviceType_operationId_key" ON "service_completion_usage"("tenantId", "serviceType", "operationId");

CREATE UNIQUE INDEX IF NOT EXISTS "teams_tenantId_name_key" ON "teams"("tenantId", "name");

CREATE INDEX IF NOT EXISTS "trial_unsubscribes_email_idx" ON "trial_unsubscribes"("email");

-- ============================================================================
-- AddForeignKey (all conditional: skip if already exists)
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE "ati_tokens" ADD CONSTRAINT "ati_tokens_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "plan_stage_model_configs" ADD CONSTRAINT "plan_stage_model_configs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "plan_stage_model_configs" ADD CONSTRAINT "plan_stage_model_configs_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "workflow_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "plan_stage_model_configs" ADD CONSTRAINT "plan_stage_model_configs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "plan_task_model_configs" ADD CONSTRAINT "plan_task_model_configs_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "plan_task_model_configs" ADD CONSTRAINT "plan_task_model_configs_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "llm_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "patent_drafting_usage" ADD CONSTRAINT "patent_drafting_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "service_completion_usage" ADD CONSTRAINT "service_completion_usage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "service_completion_usage" ADD CONSTRAINT "service_completion_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "diagram_sources" ADD CONSTRAINT "diagram_sources_translatedFromDiagramId_fkey" FOREIGN KEY ("translatedFromDiagramId") REFERENCES "diagram_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ai_review_results" ADD CONSTRAINT "ai_review_results_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "ai_review_results" ADD CONSTRAINT "ai_review_results_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "annexure_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "country_diagram_hints" ADD CONSTRAINT "country_diagram_hints_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "country_diagram_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "country_export_headings" ADD CONSTRAINT "country_export_headings_export_config_id_fkey" FOREIGN KEY ("export_config_id") REFERENCES "country_export_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_validation_overrides" ADD CONSTRAINT "user_validation_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_validation_overrides" ADD CONSTRAINT "user_validation_overrides_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "country_config_imports" ADD CONSTRAINT "country_config_imports_imported_by_fkey" FOREIGN KEY ("imported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "plan_pricing" ADD CONSTRAINT "plan_pricing_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- RenameIndex (conditional: only if old name exists and new name doesn't)
-- ============================================================================

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'country_section_mappings_country_section_key')
       AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'country_section_mappings_country_code_section_key_key')
    THEN
        ALTER INDEX "country_section_mappings_country_section_key" RENAME TO "country_section_mappings_country_code_section_key_key";
    END IF;
END $$;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'user_section_instructions_userId_sessionId_jurisdiction_secti_k')
       AND NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'user_section_instructions_user_id_session_id_jurisdiction_s_key')
    THEN
        ALTER INDEX "user_section_instructions_userId_sessionId_jurisdiction_secti_k" RENAME TO "user_section_instructions_user_id_session_id_jurisdiction_s_key";
    END IF;
END $$;
