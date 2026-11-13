-- A person's agency rules: null for AASHTO only (the default), "cdot" to show CDOT's criteria,
-- standards, pay items and tools in Design.
ALTER TABLE "user" ADD COLUMN "agency" TEXT;
