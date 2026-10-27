-- Drafting collaboration: a backup of the file before an AI app's last edit (for undo), and
-- who has each drawing open.
ALTER TABLE "drawing" ADD COLUMN "backup_key" TEXT;

CREATE TABLE "drawing_presence" (
    "id" UUID NOT NULL,
    "drawing_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "space" TEXT,
    "cursor" JSONB,
    "activity" TEXT,
    "seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drawing_presence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "drawing_presence_drawing_id_user_id_client_id_key" ON "drawing_presence"("drawing_id", "user_id", "client_id");

ALTER TABLE "drawing_presence" ADD CONSTRAINT "drawing_presence_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drawing_presence" ADD CONSTRAINT "drawing_presence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
