-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "ModelSource" AS ENUM ('upload', 'forma');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('uploading', 'translating', 'extracting', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "QuantitySource" AS ENUM ('qto_set', 'property', 'geometry', 'missing');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('unit_price', 'lump_sum');

-- CreateEnum
CREATE TYPE "MappingSource" AS ENUM ('manual', 'rule', 'classification', 'suggestion', 'inherited');

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "autodesk_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'owner',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "measurement_standard" TEXT NOT NULL DEFAULT 'CSI',
    "retention_pct" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_version" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "source" "ModelSource" NOT NULL DEFAULT 'upload',
    "file_name" TEXT NOT NULL,
    "file_size" BIGINT,
    "object_key" TEXT,
    "urn" TEXT,
    "forma_urn" TEXT,
    "forma_version_number" INTEGER,
    "schema_version" TEXT,
    "status" "ModelStatus" NOT NULL DEFAULT 'uploading',
    "translation_progress" TEXT,
    "error_message" TEXT,
    "element_count" INTEGER,
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "model_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element" (
    "id" UUID NOT NULL,
    "model_version_id" UUID NOT NULL,
    "stable_id" TEXT NOT NULL,
    "db_id" INTEGER,
    "category" TEXT,
    "type_name" TEXT,
    "level" TEXT,
    "zone" TEXT,
    "quantities" JSONB NOT NULL DEFAULT '{}',
    "quantity_source" "QuantitySource" NOT NULL DEFAULT 'missing',
    "properties" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "element_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_item" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "billing_type" "BillingType" NOT NULL DEFAULT 'unit_price',
    "contract_quantity" DECIMAL(18,4),
    "rate" DECIMAL(18,4),
    "scheduled_value" DECIMAL(18,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "line_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_rule" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL,
    "line_item_id" UUID NOT NULL,
    "quantity_key" TEXT NOT NULL,
    "is_auto" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mapping_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "element_mapping" (
    "id" UUID NOT NULL,
    "element_id" UUID NOT NULL,
    "line_item_id" UUID NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "quantity_key" TEXT NOT NULL,
    "source" "MappingSource" NOT NULL,
    "rule_id" UUID,
    "confidence" DOUBLE PRECISION,

    CONSTRAINT "element_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_autodesk_id_key" ON "user"("autodesk_id");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE INDEX "project_org_id_idx" ON "project"("org_id");

-- CreateIndex
CREATE INDEX "model_version_project_id_idx" ON "model_version"("project_id");

-- CreateIndex
CREATE INDEX "element_model_version_id_category_idx" ON "element"("model_version_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "element_model_version_id_stable_id_key" ON "element"("model_version_id", "stable_id");

-- CreateIndex
CREATE INDEX "line_item_project_id_sort_order_idx" ON "line_item"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "mapping_rule_project_id_priority_idx" ON "mapping_rule"("project_id", "priority");

-- CreateIndex
CREATE INDEX "element_mapping_line_item_id_idx" ON "element_mapping"("line_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "element_mapping_element_id_line_item_id_key" ON "element_mapping"("element_id", "line_item_id");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_version" ADD CONSTRAINT "model_version_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_version" ADD CONSTRAINT "model_version_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element" ADD CONSTRAINT "element_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_item" ADD CONSTRAINT "line_item_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "line_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_rule" ADD CONSTRAINT "mapping_rule_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_rule" ADD CONSTRAINT "mapping_rule_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mapping_rule" ADD CONSTRAINT "mapping_rule_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_mapping" ADD CONSTRAINT "element_mapping_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "element"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_mapping" ADD CONSTRAINT "element_mapping_line_item_id_fkey" FOREIGN KEY ("line_item_id") REFERENCES "line_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "element_mapping" ADD CONSTRAINT "element_mapping_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "mapping_rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
