-- Present tabular DD user data as tables instead of flattening to prose
ALTER TABLE "dd_user_data" ADD COLUMN "render_as_table" BOOLEAN NOT NULL DEFAULT false;
