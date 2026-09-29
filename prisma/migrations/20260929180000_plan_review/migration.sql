-- CreateEnum
CREATE TYPE "ReviewSheetStatus" AS ENUM ('running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('major', 'minor');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('suggested', 'kept', 'dismissed');

-- CreateTable
CREATE TABLE "reference" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "object_key" TEXT,
    "page_count" INTEGER,
    "status" "DrawingStatus" NOT NULL DEFAULT 'uploading',
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_section" (
    "id" UUID NOT NULL,
    "reference_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "reference_section_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "drawing_set_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "reference_ids" TEXT[],
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_sheet" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "status" "ReviewSheetStatus" NOT NULL DEFAULT 'running',
    "error" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_issue" (
    "id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "sheet_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "quote" TEXT,
    "box" JSONB,
    "reference_id" UUID,
    "section_id" UUID,
    "citation" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'suggested',
    "markup_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reference_org_id_idx" ON "reference"("org_id");

-- CreateIndex
CREATE INDEX "reference_section_reference_id_sort_order_idx" ON "reference_section"("reference_id", "sort_order");

-- CreateIndex
CREATE INDEX "review_project_id_idx" ON "review"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_sheet_review_id_sheet_id_key" ON "review_sheet"("review_id", "sheet_id");

-- CreateIndex
CREATE INDEX "review_issue_review_id_sheet_id_idx" ON "review_issue"("review_id", "sheet_id");

-- AddForeignKey
ALTER TABLE "reference" ADD CONSTRAINT "reference_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference" ADD CONSTRAINT "reference_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_section" ADD CONSTRAINT "reference_section_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_drawing_set_id_fkey" FOREIGN KEY ("drawing_set_id") REFERENCES "drawing_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review" ADD CONSTRAINT "review_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sheet" ADD CONSTRAINT "review_sheet_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_sheet" ADD CONSTRAINT "review_sheet_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issue" ADD CONSTRAINT "review_issue_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issue" ADD CONSTRAINT "review_issue_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issue" ADD CONSTRAINT "review_issue_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "reference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issue" ADD CONSTRAINT "review_issue_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "reference_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;

