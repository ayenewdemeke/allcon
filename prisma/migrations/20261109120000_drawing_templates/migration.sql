-- Drawing templates (AutoCAD's DWT): a drawing new drawings start from.
ALTER TABLE "drawing" ADD COLUMN "is_template" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "drawing" ADD COLUMN "description" TEXT;
