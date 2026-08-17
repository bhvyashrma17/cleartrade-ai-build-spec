-- Social-auth provider-account linkage table.
CREATE TABLE "AuthProviderAccount" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_account_id" VARCHAR(191) NOT NULL,
    "provider_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthProviderAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthProviderAccount_provider_provider_account_id_key"
    ON "AuthProviderAccount"("provider", "provider_account_id");

CREATE UNIQUE INDEX "AuthProviderAccount_user_id_provider_key"
    ON "AuthProviderAccount"("user_id", "provider");

CREATE INDEX "AuthProviderAccount_user_id_idx"
    ON "AuthProviderAccount"("user_id");

ALTER TABLE "AuthProviderAccount"
    ADD CONSTRAINT "AuthProviderAccount_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
