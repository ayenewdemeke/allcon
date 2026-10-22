-- Every model's file must already be in storage (scripts/move-model-files.mjs).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ifc_model" WHERE "file_key" IS NULL) THEN
    RAISE EXCEPTION 'Some 3D models have no file_key: run scripts/move-model-files.mjs first';
  END IF;
END $$;

ALTER TABLE "ifc_model" ALTER COLUMN "file_key" SET NOT NULL;
ALTER TABLE "ifc_model"
  DROP COLUMN "kind",
  DROP COLUMN "spec",
  DROP COLUMN "ifc_gz",
  DROP COLUMN "elements_revision";

-- One backup per model now lives in storage; viewer copies too.
DROP TABLE "ifc_model_revision";
DROP TABLE "ifc_model_view_cache";
