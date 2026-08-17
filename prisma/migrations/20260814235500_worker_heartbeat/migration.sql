CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL, "instance_id" TEXT NOT NULL, "status" TEXT NOT NULL,
  "active_job_id" TEXT, "last_seen_at" TIMESTAMP(3) NOT NULL,
  "last_error_at" TIMESTAMP(3), "last_error" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkerHeartbeat_last_seen_at_idx" ON "WorkerHeartbeat"("last_seen_at");
