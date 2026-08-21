CREATE TABLE "BugReport" (
    "id" TEXT NOT NULL,
    "reporter_user_id" TEXT NOT NULL,
    "reporter_role" "UserRole" NOT NULL,
    "subject" VARCHAR(160) NOT NULL,
    "what_happened" TEXT NOT NULL,
    "expected" TEXT NOT NULL,
    "page_url" VARCHAR(2048),
    "app_environment" VARCHAR(32) NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BugReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BugReport_correlation_id_key" ON "BugReport"("correlation_id");
CREATE INDEX "BugReport_reporter_user_id_created_at_idx" ON "BugReport"("reporter_user_id", "created_at");
CREATE INDEX "BugReport_created_at_idx" ON "BugReport"("created_at");
ALTER TABLE "BugReport" ADD CONSTRAINT "BugReport_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
