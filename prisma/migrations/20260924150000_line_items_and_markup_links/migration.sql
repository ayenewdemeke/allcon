-- Line item headings and rate source; 2D measurements can be assigned to line items.
-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('contract', 'library');
-- AlterTable
ALTER TABLE "line_item" ADD COLUMN     "is_heading" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rate_source" "RateSource" NOT NULL DEFAULT 'contract';
-- AlterTable
ALTER TABLE "markup" ADD COLUMN     "line_item_id" UUID;
-- CreateIndex
CREATE INDEX "markup_line_item_id_idx" ON "markup"("line_item_id");
-- AddForeignKey
ALTER TABLE "markup" ADD CONSTRAINT "markup_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
