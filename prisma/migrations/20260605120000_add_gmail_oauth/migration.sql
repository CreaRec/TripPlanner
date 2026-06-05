-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "provider" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_accounts" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "google_email" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- CreateIndex
CREATE INDEX "gmail_accounts_telegram_id_idx" ON "gmail_accounts"("telegram_id");

-- CreateIndex
CREATE INDEX "gmail_accounts_telegram_id_status_idx" ON "gmail_accounts"("telegram_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_accounts_telegram_id_google_email_key" ON "gmail_accounts"("telegram_id", "google_email");

-- AddForeignKey
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_telegram_id_fkey" FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_accounts" ADD CONSTRAINT "gmail_accounts_telegram_id_fkey" FOREIGN KEY ("telegram_id") REFERENCES "tg_users"("telegram_id") ON DELETE CASCADE ON UPDATE CASCADE;
