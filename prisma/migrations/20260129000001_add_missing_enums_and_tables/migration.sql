-- ============================================================================
-- Add missing enums and tables that exist in schema but not in database
-- ============================================================================

-- 1. Add missing enum values to FeatureCode
ALTER TYPE "FeatureCode" ADD VALUE IF NOT EXISTS 'PATENT_REVIEW';

-- 2. Add missing enum values to TaskCode
ALTER TYPE "TaskCode" ADD VALUE IF NOT EXISTS 'LLM1_CLAIM_REFINEMENT';

-- 3. Create ServiceType enum (used for service access control)
DO $$ BEGIN
    CREATE TYPE "ServiceType" AS ENUM (
        'PATENT_DRAFTING',
        'NOVELTY_SEARCH',
        'PRIOR_ART_SEARCH',
        'IDEA_BANK',
        'PERSONA_SYNC',
        'DIAGRAM_GENERATION',
        'PATENT_REVIEW',
        'IDEATION'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 4. Create TeamRole enum
DO $$ BEGIN
    CREATE TYPE "TeamRole" AS ENUM ('LEAD', 'MEMBER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 5. Create Teams table
CREATE TABLE IF NOT EXISTS "teams" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- 6. Create TeamMember table
CREATE TABLE IF NOT EXISTS "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- 7. Create TeamServiceAccess table
CREATE TABLE IF NOT EXISTS "team_service_access" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyQuota" INTEGER,
    "dailyQuota" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_service_access_pkey" PRIMARY KEY ("id")
);

-- 8. Create UserServiceQuota table
CREATE TABLE IF NOT EXISTS "user_service_quotas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monthlyQuota" INTEGER,
    "dailyQuota" INTEGER,
    "currentMonthUsage" INTEGER NOT NULL DEFAULT 0,
    "currentDayUsage" INTEGER NOT NULL DEFAULT 0,
    "lastResetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_service_quotas_pkey" PRIMARY KEY ("id")
);

-- 9. Create ServiceCompletionUsage table
CREATE TABLE IF NOT EXISTS "service_completion_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "operationId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completionDate" TEXT,
    "completionMonth" TEXT,
    "completedAt" TIMESTAMP(3),
    "inputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "outputTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "totalTokensUsed" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_completion_usage_pkey" PRIMARY KEY ("id")
);

-- ============================================================================
-- Create indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS "teams_tenantId_idx" ON "teams"("tenantId");

CREATE UNIQUE INDEX IF NOT EXISTS "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "team_members_userId_idx" ON "team_members"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "team_service_access_teamId_serviceType_key" ON "team_service_access"("teamId", "serviceType");

CREATE UNIQUE INDEX IF NOT EXISTS "user_service_quotas_userId_serviceType_key" ON "user_service_quotas"("userId", "serviceType");

CREATE INDEX IF NOT EXISTS "service_completion_usage_tenantId_idx" ON "service_completion_usage"("tenantId");
CREATE INDEX IF NOT EXISTS "service_completion_usage_userId_idx" ON "service_completion_usage"("userId");
CREATE INDEX IF NOT EXISTS "service_completion_usage_operationId_idx" ON "service_completion_usage"("operationId");
CREATE INDEX IF NOT EXISTS "service_completion_usage_serviceType_isCompleted_idx" ON "service_completion_usage"("serviceType", "isCompleted");

-- ============================================================================
-- Add foreign keys
-- ============================================================================

DO $$ BEGIN
    ALTER TABLE "teams" ADD CONSTRAINT "teams_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" 
        FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "team_service_access" ADD CONSTRAINT "team_service_access_teamId_fkey" 
        FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_service_quotas" ADD CONSTRAINT "user_service_quotas_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "service_completion_usage" ADD CONSTRAINT "service_completion_usage_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "service_completion_usage" ADD CONSTRAINT "service_completion_usage_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Writing Personas and Samples (Persona Sync feature)
-- ============================================================================

-- 10. Create PersonaVisibility enum
DO $$ BEGIN
    CREATE TYPE "PersonaVisibility" AS ENUM ('PRIVATE', 'ORGANIZATION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 11. Create WritingPersona table
CREATE TABLE IF NOT EXISTS "writing_personas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "PersonaVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "allowCopy" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_personas_pkey" PRIMARY KEY ("id")
);

-- 12. Create WritingSample table
CREATE TABLE IF NOT EXISTS "writing_samples" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personaId" TEXT,
    "personaName" TEXT NOT NULL DEFAULT 'Default',
    "jurisdiction" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "sampleText" TEXT NOT NULL,
    "notes" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "writing_samples_pkey" PRIMARY KEY ("id")
);

-- Writing personas indexes
CREATE UNIQUE INDEX IF NOT EXISTS "writing_personas_createdBy_name_key" ON "writing_personas"("createdBy", "name");
CREATE INDEX IF NOT EXISTS "writing_personas_tenantId_visibility_idx" ON "writing_personas"("tenantId", "visibility");
CREATE INDEX IF NOT EXISTS "writing_personas_createdBy_idx" ON "writing_personas"("createdBy");

-- Writing samples indexes
CREATE UNIQUE INDEX IF NOT EXISTS "writing_samples_userId_jurisdiction_personaId_sectionKey_key" ON "writing_samples"("userId", "jurisdiction", "personaId", "sectionKey");
CREATE INDEX IF NOT EXISTS "writing_samples_tenantId_userId_idx" ON "writing_samples"("tenantId", "userId");
CREATE INDEX IF NOT EXISTS "writing_samples_userId_jurisdiction_idx" ON "writing_samples"("userId", "jurisdiction");
CREATE INDEX IF NOT EXISTS "writing_samples_personaId_idx" ON "writing_samples"("personaId");

-- Writing personas foreign keys
DO $$ BEGIN
    ALTER TABLE "writing_personas" ADD CONSTRAINT "writing_personas_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "writing_personas" ADD CONSTRAINT "writing_personas_createdBy_fkey" 
        FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Writing samples foreign keys
DO $$ BEGIN
    ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_userId_fkey" 
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_personaId_fkey" 
        FOREIGN KEY ("personaId") REFERENCES "writing_personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Sketch Records (Diagram Generation)
-- ============================================================================

-- 13. Create SketchMode enum
DO $$ BEGIN
    CREATE TYPE "SketchMode" AS ENUM ('AUTO', 'GUIDED', 'REFINE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 14. Create SketchStatus enum
DO $$ BEGIN
    CREATE TYPE "SketchStatus" AS ENUM ('SUGGESTED', 'PENDING', 'SUCCESS', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 15. Create SketchRecord table
CREATE TABLE IF NOT EXISTS "sketch_records" (
    "id" TEXT NOT NULL,
    "patentId" TEXT NOT NULL,
    "sessionId" TEXT,
    "figureNo" INTEGER,
    "mode" "SketchMode" NOT NULL DEFAULT 'AUTO',
    "status" "SketchStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "userPrompt" TEXT,
    "contextFlags" JSONB,
    "sourceSketchId" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "viewsRequested" JSONB,
    "imagePath" TEXT,
    "imageFilename" TEXT,
    "imageWidth" INTEGER,
    "imageHeight" INTEGER,
    "imageChecksum" TEXT,
    "originalImagePath" TEXT,
    "originalImageFilename" TEXT,
    "aiModel" TEXT,
    "aiPromptUsed" TEXT,
    "aiResponseMeta" JSONB,
    "tokensUsed" INTEGER,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sketch_records_pkey" PRIMARY KEY ("id")
);

-- SketchRecord indexes
CREATE INDEX IF NOT EXISTS "sketch_records_patentId_idx" ON "sketch_records"("patentId");
CREATE INDEX IF NOT EXISTS "sketch_records_sessionId_idx" ON "sketch_records"("sessionId");
CREATE INDEX IF NOT EXISTS "sketch_records_sourceSketchId_idx" ON "sketch_records"("sourceSketchId");
CREATE INDEX IF NOT EXISTS "sketch_records_status_idx" ON "sketch_records"("status");

-- SketchRecord foreign keys
DO $$ BEGIN
    ALTER TABLE "sketch_records" ADD CONSTRAINT "sketch_records_patentId_fkey" 
        FOREIGN KEY ("patentId") REFERENCES "patents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sketch_records" ADD CONSTRAINT "sketch_records_sessionId_fkey" 
        FOREIGN KEY ("sessionId") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "sketch_records" ADD CONSTRAINT "sketch_records_sourceSketchId_fkey" 
        FOREIGN KEY ("sourceSketchId") REFERENCES "sketch_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Usage Tracking Tables
-- ============================================================================

-- 16. Create DiagramGenerationUsage table
CREATE TABLE IF NOT EXISTS "diagram_generation_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "figureNo" INTEGER NOT NULL,
    "generationCount" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "countedDate" TEXT,
    "countedMonth" TEXT,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagram_generation_usage_pkey" PRIMARY KEY ("id")
);

-- DiagramGenerationUsage indexes
CREATE UNIQUE INDEX IF NOT EXISTS "diagram_generation_usage_tenantId_sessionId_figureNo_key" ON "diagram_generation_usage"("tenantId", "sessionId", "figureNo");
CREATE INDEX IF NOT EXISTS "diagram_generation_usage_tenantId_countedDate_idx" ON "diagram_generation_usage"("tenantId", "countedDate");
CREATE INDEX IF NOT EXISTS "diagram_generation_usage_tenantId_countedMonth_idx" ON "diagram_generation_usage"("tenantId", "countedMonth");

-- DiagramGenerationUsage foreign keys
DO $$ BEGIN
    ALTER TABLE "diagram_generation_usage" ADD CONSTRAINT "diagram_generation_usage_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 17. Create SketchGenerationUsage table
CREATE TABLE IF NOT EXISTS "sketch_generation_usage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sketchId" TEXT NOT NULL,
    "generationCount" INTEGER NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "totalInputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "countedDate" TEXT,
    "countedMonth" TEXT,
    "countedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sketch_generation_usage_pkey" PRIMARY KEY ("id")
);

-- SketchGenerationUsage indexes
CREATE UNIQUE INDEX IF NOT EXISTS "sketch_generation_usage_tenantId_sessionId_sketchId_key" ON "sketch_generation_usage"("tenantId", "sessionId", "sketchId");
CREATE INDEX IF NOT EXISTS "sketch_generation_usage_tenantId_countedDate_idx" ON "sketch_generation_usage"("tenantId", "countedDate");

-- SketchGenerationUsage foreign keys
DO $$ BEGIN
    ALTER TABLE "sketch_generation_usage" ADD CONSTRAINT "sketch_generation_usage_tenantId_fkey" 
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- User Style Override Tables
-- ============================================================================

-- 18. Create UserDiagramStyle table
CREATE TABLE IF NOT EXISTS "user_diagram_styles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "diagram_type" TEXT,
    "custom_hint" TEXT,
    "custom_color_allowed" BOOLEAN,
    "custom_line_style" TEXT,
    "custom_min_ref_text_size_pt" INTEGER,
    "custom_figure_label_format" TEXT,
    "preferred_diagram_count" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_diagram_styles_pkey" PRIMARY KEY ("id")
);

-- UserDiagramStyle indexes
CREATE UNIQUE INDEX IF NOT EXISTS "user_diagram_styles_user_id_session_id_jurisdiction_diagram_key" ON "user_diagram_styles"("user_id", "session_id", "jurisdiction", "diagram_type");
CREATE INDEX IF NOT EXISTS "user_diagram_styles_user_id_idx" ON "user_diagram_styles"("user_id");
CREATE INDEX IF NOT EXISTS "user_diagram_styles_session_id_idx" ON "user_diagram_styles"("session_id");
CREATE INDEX IF NOT EXISTS "user_diagram_styles_tenant_id_idx" ON "user_diagram_styles"("tenant_id");

-- UserDiagramStyle foreign keys
DO $$ BEGIN
    ALTER TABLE "user_diagram_styles" ADD CONSTRAINT "user_diagram_styles_user_id_fkey" 
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_diagram_styles" ADD CONSTRAINT "user_diagram_styles_tenant_id_fkey" 
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_diagram_styles" ADD CONSTRAINT "user_diagram_styles_session_id_fkey" 
        FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 19. Create UserExportStyle table
CREATE TABLE IF NOT EXISTS "user_export_styles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT,
    "jurisdiction" TEXT NOT NULL DEFAULT '*',
    "font_family" TEXT,
    "font_size_pt" INTEGER,
    "line_spacing" DOUBLE PRECISION,
    "margin_top_cm" DOUBLE PRECISION,
    "margin_bottom_cm" DOUBLE PRECISION,
    "margin_left_cm" DOUBLE PRECISION,
    "margin_right_cm" DOUBLE PRECISION,
    "add_page_numbers" BOOLEAN,
    "add_paragraph_numbers" BOOLEAN,
    "custom_options" JSONB DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_export_styles_pkey" PRIMARY KEY ("id")
);

-- UserExportStyle indexes
CREATE UNIQUE INDEX IF NOT EXISTS "user_export_styles_user_id_session_id_jurisdiction_key" ON "user_export_styles"("user_id", "session_id", "jurisdiction");
CREATE INDEX IF NOT EXISTS "user_export_styles_user_id_idx" ON "user_export_styles"("user_id");
CREATE INDEX IF NOT EXISTS "user_export_styles_session_id_idx" ON "user_export_styles"("session_id");
CREATE INDEX IF NOT EXISTS "user_export_styles_tenant_id_idx" ON "user_export_styles"("tenant_id");

-- UserExportStyle foreign keys
DO $$ BEGIN
    ALTER TABLE "user_export_styles" ADD CONSTRAINT "user_export_styles_user_id_fkey" 
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_export_styles" ADD CONSTRAINT "user_export_styles_tenant_id_fkey" 
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "user_export_styles" ADD CONSTRAINT "user_export_styles_session_id_fkey" 
        FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
