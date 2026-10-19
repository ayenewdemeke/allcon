-- CreateTable
CREATE TABLE "ifc_model_view_cache" (
    "model_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ifc_model_view_cache_pkey" PRIMARY KEY ("model_id")
);

-- AddForeignKey
ALTER TABLE "ifc_model_view_cache" ADD CONSTRAINT "ifc_model_view_cache_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "ifc_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

