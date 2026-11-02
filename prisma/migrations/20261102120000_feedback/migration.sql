-- Feedback: ideas, bugs and questions people send from the app, with their status and a reply.
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "org_id" UUID,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "page" TEXT,
    "user_agent" TEXT,
    "app_version" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'new',
    "reply" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "feedback_user_id_idx" ON "feedback"("user_id");
CREATE INDEX "feedback_status_created_at_idx" ON "feedback"("status", "created_at");

ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
