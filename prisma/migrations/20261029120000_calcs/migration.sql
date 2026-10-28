-- Calcs: calculation worksheets (math with units on pages, as in Mathcad).
CREATE TABLE "calc" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID,
    "name" TEXT NOT NULL,
    "file_key" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "region_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calc_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "calc_org_id_idx" ON "calc"("org_id");
CREATE INDEX "calc_project_id_idx" ON "calc"("project_id");

ALTER TABLE "calc" ADD CONSTRAINT "calc_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calc" ADD CONSTRAINT "calc_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
