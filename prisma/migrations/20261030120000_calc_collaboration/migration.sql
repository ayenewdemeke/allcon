-- Calcs collaboration: a backup of the file before an AI app's last edit (for undo), and who has
-- each worksheet open.
ALTER TABLE "calc" ADD COLUMN "backup_key" TEXT;

CREATE TABLE "calc_presence" (
    "id" UUID NOT NULL,
    "calc_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "region" TEXT,
    "cursor" JSONB,
    "activity" TEXT,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calc_presence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calc_presence_calc_id_user_id_client_id_key" ON "calc_presence"("calc_id", "user_id", "client_id");

ALTER TABLE "calc_presence" ADD CONSTRAINT "calc_presence_calc_id_fkey" FOREIGN KEY ("calc_id") REFERENCES "calc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calc_presence" ADD CONSTRAINT "calc_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
