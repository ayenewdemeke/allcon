-- Move sign-in to Better Auth: session/account/verification tables.
-- Hand-edited so existing Autodesk identities carry over as "autodesk" accounts.

-- Old sessions use a different token format; users simply sign in again.
DELETE FROM "session";

ALTER TABLE "session" ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "token" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_agent" TEXT;

CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "account_user_id_idx" ON "account"("user_id");
CREATE UNIQUE INDEX "account_provider_id_account_id_key" ON "account"("provider_id", "account_id");
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry each user's Autodesk identity over before dropping the old column.
INSERT INTO "account" ("id", "account_id", "provider_id", "user_id")
SELECT gen_random_uuid()::text, "autodesk_id", 'autodesk', "id" FROM "user" WHERE "autodesk_id" IS NOT NULL;

ALTER TABLE "user" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Autodesk only issues verified email addresses.
UPDATE "user" SET "email_verified" = true WHERE "autodesk_id" IS NOT NULL;

DROP INDEX "user_autodesk_id_key";
ALTER TABLE "user" DROP COLUMN "autodesk_id";

CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");
