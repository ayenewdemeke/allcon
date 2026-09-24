-- Raw Model Derivative property dumps live in object storage; this column points to one.
-- AlterTable
ALTER TABLE "model_version" ADD COLUMN     "properties_object_key" TEXT;
