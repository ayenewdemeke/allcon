-- Bridge: a bridge modeled once, analyzed and designed (the Bridge section). The definition is a few
-- kilobytes; the analysis model and results are worked out in the browser, not stored.
CREATE TABLE "bridge" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "project_id" UUID,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bridge_org_id_idx" ON "bridge"("org_id");
CREATE INDEX "bridge_project_id_idx" ON "bridge"("project_id");

ALTER TABLE "bridge" ADD CONSTRAINT "bridge_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bridge" ADD CONSTRAINT "bridge_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
