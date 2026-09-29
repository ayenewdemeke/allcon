-- Read-only share links for marked-up sheets.
-- CreateTable
CREATE TABLE "share_link" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "project_id" UUID NOT NULL,
    "drawing_set_id" UUID NOT NULL,
    "sheet_ids" TEXT[],
    "include_prices" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "share_link_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "share_link_token_key" ON "share_link"("token");
-- CreateIndex
CREATE INDEX "share_link_drawing_set_id_idx" ON "share_link"("drawing_set_id");
-- AddForeignKey
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_drawing_set_id_fkey" FOREIGN KEY ("drawing_set_id") REFERENCES "drawing_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
