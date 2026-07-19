-- Prior-Art Studio: pinned §102/§103 theories with attorney-authored motivation.

CREATE TABLE "prior_art_studio_theories" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "publicationNumbers" TEXT[],
    "familyKeys" TEXT[],
    "motivation" TEXT NOT NULL,
    "elementCoverage" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prior_art_studio_theories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prior_art_studio_theories_sessionId_createdAt_idx" ON "prior_art_studio_theories"("sessionId", "createdAt");

ALTER TABLE "prior_art_studio_theories" ADD CONSTRAINT "prior_art_studio_theories_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "prior_art_studio_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
