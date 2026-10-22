-- 3D model files move to file storage (R2): the database keeps their keys. Fill these with
-- scripts/move-model-files.mjs before the next migration drops the old columns.
ALTER TABLE "ifc_model"
  ADD COLUMN "file_key" TEXT,
  ADD COLUMN "file_size" INTEGER,
  ADD COLUMN "backup_key" TEXT,
  ADD COLUMN "backup_revision" INTEGER,
  ADD COLUMN "edit_client_id" TEXT,
  ADD COLUMN "edited_at" TIMESTAMP(3),
  ADD COLUMN "view_key" TEXT,
  ADD COLUMN "view_for" TEXT,
  ADD COLUMN "elements_for" TEXT;
