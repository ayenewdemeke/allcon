-- CreateTable
CREATE TABLE "ifc_model" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "spec" JSONB NOT NULL,
    "element_count" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "source_sheet_ids" TEXT[],
    "client_id" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ifc_model_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ifc_model_revision" (
    "id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ifc_model_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ifc_model_project_id_idx" ON "ifc_model"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "ifc_model_revision_model_id_revision_key" ON "ifc_model_revision"("model_id", "revision");

-- AddForeignKey
ALTER TABLE "ifc_model" ADD CONSTRAINT "ifc_model_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ifc_model_revision" ADD CONSTRAINT "ifc_model_revision_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ifc_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

