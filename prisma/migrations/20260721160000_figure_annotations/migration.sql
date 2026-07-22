-- Editable annotation layer for the in-browser figure editor.
-- Stores the canvas editor's shapes so edits stay re-editable instead of being
-- flattened irreversibly into the rendered PNG.
ALTER TABLE "diagram_sources" ADD COLUMN "annotations" JSONB;
ALTER TABLE "sketch_records" ADD COLUMN "annotations" JSONB;
