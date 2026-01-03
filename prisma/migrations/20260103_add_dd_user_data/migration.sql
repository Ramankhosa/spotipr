-- CreateTable: DD User Data for Detailed Description section
-- This table stores user-provided illustrative data (experimental results, test measurements)
-- that can be optionally injected into the Detailed Description section during patent drafting.

CREATE TABLE "dd_user_data" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_data" TEXT NOT NULL,
    "jurisdiction_toggles" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "dd_user_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on session_id (one DD user data record per session)
CREATE UNIQUE INDEX "dd_user_data_session_id_key" ON "dd_user_data"("session_id");

-- AddForeignKey: Link to DraftingSession
ALTER TABLE "dd_user_data" ADD CONSTRAINT "dd_user_data_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "drafting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

