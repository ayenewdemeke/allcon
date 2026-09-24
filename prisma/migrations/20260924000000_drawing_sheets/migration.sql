-- PDF drawing sets, their sheets, and markups/measurements drawn on them.

-- CreateEnum
CREATE TYPE "UnitSystem" AS ENUM ('imperial', 'metric');

-- CreateEnum
CREATE TYPE "DrawingStatus" AS ENUM ('uploading', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "MarkupKind" AS ENUM ('length', 'area', 'count', 'note', 'arrow', 'cloud');

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "unit_system" "UnitSystem" NOT NULL DEFAULT 'imperial';

-- CreateTable
CREATE TABLE "drawing_set" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "object_key" TEXT,
    "page_count" INTEGER,
    "status" "DrawingStatus" NOT NULL DEFAULT 'uploading',
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawing_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sheet" (
    "id" UUID NOT NULL,
    "drawing_set_id" UUID NOT NULL,
    "page_index" INTEGER NOT NULL,
    "number" TEXT,
    "title" TEXT,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "meters_per_point" DOUBLE PRECISION,
    "scale_label" TEXT,

    CONSTRAINT "sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "markup" (
    "id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "kind" "MarkupKind" NOT NULL,
    "points" JSONB NOT NULL,
    "label" TEXT,
    "text" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "depth" DOUBLE PRECISION,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "markup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drawing_set_project_id_idx" ON "drawing_set"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "sheet_drawing_set_id_page_index_key" ON "sheet"("drawing_set_id", "page_index");

-- CreateIndex
CREATE INDEX "markup_sheet_id_idx" ON "markup"("sheet_id");

-- AddForeignKey
ALTER TABLE "drawing_set" ADD CONSTRAINT "drawing_set_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drawing_set" ADD CONSTRAINT "drawing_set_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet" ADD CONSTRAINT "sheet_drawing_set_id_fkey" FOREIGN KEY ("drawing_set_id") REFERENCES "drawing_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markup" ADD CONSTRAINT "markup_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markup" ADD CONSTRAINT "markup_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

