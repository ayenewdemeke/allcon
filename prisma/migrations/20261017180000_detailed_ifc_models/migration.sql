-- AlterTable
ALTER TABLE "ifc_model" ADD COLUMN     "ifc_gz" BYTEA,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'spec',
ADD COLUMN     "summary" JSONB,
ALTER COLUMN "spec" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ifc_model_revision" ADD COLUMN     "ifc_gz" BYTEA,
ALTER COLUMN "spec" DROP NOT NULL;

