-- AlterTable
ALTER TABLE "element" ADD COLUMN     "ifc_model_id" UUID,
ALTER COLUMN "model_version_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ifc_model" ADD COLUMN     "count_in_quantities" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "elements_revision" INTEGER;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "count_uploads" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "element_ifc_model_id_category_idx" ON "element"("ifc_model_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "element_ifc_model_id_stable_id_key" ON "element"("ifc_model_id", "stable_id");

-- AddForeignKey
ALTER TABLE "element" ADD CONSTRAINT "element_ifc_model_id_fkey" FOREIGN KEY ("ifc_model_id") REFERENCES "ifc_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

