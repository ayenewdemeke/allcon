-- 2D drawings made in Drafting; their content is a JSON file in file storage.
CREATE TABLE "drawing" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "file_key" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "entity_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drawing_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "drawing_project_id_idx" ON "drawing"("project_id");
ALTER TABLE "drawing" ADD CONSTRAINT "drawing_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
