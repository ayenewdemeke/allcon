-- CreateTable
CREATE TABLE "jwks" (
    "id" UUID NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "client_discovery_id" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skip_consent" BOOLEAN,
    "enable_end_session" BOOLEAN,
    "subject_type" TEXT,
    "scopes" TEXT[],
    "client_credentials_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_id" UUID,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "software_id" TEXT,
    "software_version" TEXT,
    "software_statement" TEXT,
    "redirect_uris" TEXT[],
    "post_logout_redirect_uris" TEXT[],
    "backchannel_logout_uri" TEXT,
    "backchannel_logout_session_required" BOOLEAN,
    "token_endpoint_auth_method" TEXT,
    "application_type" TEXT,
    "jwks" TEXT,
    "jwks_uri" TEXT,
    "grant_types" TEXT[],
    "response_types" TEXT[],
    "require_p_k_c_e" BOOLEAN,
    "dpop_bound_access_tokens" BOOLEAN DEFAULT false,
    "reference_id" TEXT,
    "metadata" JSONB,

    CONSTRAINT "oauth_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_resource" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token_ttl" INTEGER,
    "refresh_token_ttl" INTEGER,
    "signing_algorithm" TEXT,
    "signing_key_id" TEXT,
    "allowed_scopes" TEXT[],
    "custom_claims" JSONB,
    "dpop_bound_access_tokens_required" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "policy_version" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauth_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_resource" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "oauth_client_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_refresh_token" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" UUID NOT NULL,
    "reference_id" TEXT,
    "authorization_code_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "rotation_replay_response" TEXT,
    "rotation_replay_expires_at" TIMESTAMP(3),
    "auth_time" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],

    CONSTRAINT "oauth_refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_access_token" (
    "id" UUID NOT NULL,
    "token" TEXT,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" UUID,
    "reference_id" TEXT,
    "authorization_code_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "refresh_id" UUID,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],

    CONSTRAINT "oauth_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_consent" (
    "id" UUID NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" UUID,
    "reference_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "scopes" TEXT[],
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "oauth_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_assertion" (
    "id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_activity" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" TEXT,
    "tool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "project_id" UUID,
    "markup_ids" TEXT[],
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_client_user_id_idx" ON "oauth_client"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_client_id_key" ON "oauth_client"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_resource_identifier_key" ON "oauth_resource"("identifier");

-- CreateIndex
CREATE INDEX "oauth_client_resource_client_id_idx" ON "oauth_client_resource"("client_id");

-- CreateIndex
CREATE INDEX "oauth_client_resource_resource_id_idx" ON "oauth_client_resource"("resource_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_client_id_idx" ON "oauth_refresh_token"("client_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_session_id_idx" ON "oauth_refresh_token"("session_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_user_id_idx" ON "oauth_refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_authorization_code_id_idx" ON "oauth_refresh_token"("authorization_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_refresh_token_token_key" ON "oauth_refresh_token"("token");

-- CreateIndex
CREATE INDEX "oauth_access_token_client_id_idx" ON "oauth_access_token"("client_id");

-- CreateIndex
CREATE INDEX "oauth_access_token_session_id_idx" ON "oauth_access_token"("session_id");

-- CreateIndex
CREATE INDEX "oauth_access_token_user_id_idx" ON "oauth_access_token"("user_id");

-- CreateIndex
CREATE INDEX "oauth_access_token_authorization_code_id_idx" ON "oauth_access_token"("authorization_code_id");

-- CreateIndex
CREATE INDEX "oauth_access_token_refresh_id_idx" ON "oauth_access_token"("refresh_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_token_token_key" ON "oauth_access_token"("token");

-- CreateIndex
CREATE INDEX "oauth_consent_client_id_idx" ON "oauth_consent"("client_id");

-- CreateIndex
CREATE INDEX "oauth_consent_user_id_idx" ON "oauth_consent"("user_id");

-- CreateIndex
CREATE INDEX "mcp_activity_user_id_created_at_idx" ON "mcp_activity"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refresh_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_client"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_activity" ADD CONSTRAINT "mcp_activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_activity" ADD CONSTRAINT "mcp_activity_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

