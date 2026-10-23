-- Projects pinned on a map, and models placed on it by hand.
ALTER TABLE "project" ADD COLUMN "latitude" DOUBLE PRECISION, ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "ifc_model" ADD COLUMN "placement" JSONB;
