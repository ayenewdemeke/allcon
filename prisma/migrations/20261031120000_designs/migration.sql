-- Design: designs made in the Design section (walls for now), filed under a project if wanted.
CREATE TABLE "design" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "design_org_id_idx" ON "design"("org_id");
CREATE INDEX "design_project_id_idx" ON "design"("project_id");

ALTER TABLE "design" ADD CONSTRAINT "design_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "design" ADD CONSTRAINT "design_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
