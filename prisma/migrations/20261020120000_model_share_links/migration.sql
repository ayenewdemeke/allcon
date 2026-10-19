-- CreateTable
CREATE TABLE "model_share_link" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "model_id" UUID NOT NULL,
    "allow_download" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_share_link_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "model_share_link_token_key" ON "model_share_link"("token");

-- CreateIndex
CREATE INDEX "model_share_link_model_id_idx" ON "model_share_link"("model_id");

-- AddForeignKey
ALTER TABLE "model_share_link" ADD CONSTRAINT "model_share_link_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ifc_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_share_link" ADD CONSTRAINT "model_share_link_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

