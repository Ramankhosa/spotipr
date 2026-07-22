ALTER TABLE "figure_plans"
  ADD COLUMN "diagram_type" TEXT,
  ADD COLUMN "semantic_schema_version" INTEGER,
  ADD COLUMN "semantic_model" JSONB,
  ADD COLUMN "semantic_checksum" TEXT,
  ADD COLUMN "reference_map_checksum" TEXT,
  ADD COLUMN "validation_report" JSONB,
  ADD COLUMN "detail_of_figure_no" INTEGER;

ALTER TABLE "diagram_sources"
  ADD COLUMN "source_mode" TEXT NOT NULL DEFAULT 'MANAGED',
  ADD COLUMN "label_map" JSONB,
  ADD COLUMN "render_artifacts" JSONB,
  ADD COLUMN "render_status" TEXT,
  ADD COLUMN "render_error" TEXT,
  ADD COLUMN "semantic_checksum" TEXT,
  ADD COLUMN "reference_map_checksum" TEXT,
  ADD COLUMN "translated_from_checksum" TEXT;

UPDATE "diagram_sources"
SET "source_mode" = CASE
  WHEN COALESCE(BTRIM("plantumlCode"), '') <> '' THEN 'IMPORTED_RAW'
  ELSE 'IMPORTED_IMAGE'
END;
