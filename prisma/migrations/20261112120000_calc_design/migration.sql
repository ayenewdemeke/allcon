-- A calc made from a design (its calc package or quantity sheet) keeps the design it came from, so
-- the Calcs list can group worksheets by design tool.
ALTER TABLE "calc" ADD COLUMN "design_id" UUID;

ALTER TABLE "calc" ADD CONSTRAINT "calc_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "design"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "calc_design_id_idx" ON "calc"("design_id");

-- Existing calcs: those made from a design are named after it ("<design> calc", "<design> ASD calc",
-- "<design> quantities"), sometimes with more added since. Link each to the design in its organization
-- with the longest name it starts with, followed by a space.
UPDATE "calc" AS c
SET "design_id" = m."design_id"
FROM (
  SELECT DISTINCT ON (c2."id") c2."id" AS "calc_id", d."id" AS "design_id"
  FROM "calc" AS c2
  JOIN "design" AS d ON d."org_id" = c2."org_id" AND left(c2."name", length(d."name") + 1) = d."name" || ' '
  ORDER BY c2."id", length(d."name") DESC, d."updated_at" DESC
) AS m
WHERE c."id" = m."calc_id";
