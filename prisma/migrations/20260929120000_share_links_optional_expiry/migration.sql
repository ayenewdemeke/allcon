-- A share link may have no expiry (it stays valid until revoked).
ALTER TABLE "share_link" ALTER COLUMN "expires_at" DROP NOT NULL;
