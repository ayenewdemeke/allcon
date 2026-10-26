-- Drawings belong to the organization (Drafting in the main panel); a project is optional.
ALTER TABLE "drawing" ADD COLUMN "org_id" UUID, ADD COLUMN "units" TEXT NOT NULL DEFAULT 'architectural';
UPDATE "drawing" d SET "org_id" = p."org_id", "units" = CASE p."unit_system" WHEN 'metric' THEN 'mm' ELSE 'architectural' END FROM "project" p WHERE p."id" = d."project_id";
ALTER TABLE "drawing" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "drawing" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "drawing" DROP CONSTRAINT "drawing_project_id_fkey";
ALTER TABLE "drawing" ADD CONSTRAINT "drawing_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "drawing" ADD CONSTRAINT "drawing_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "drawing_org_id_idx" ON "drawing"("org_id");
