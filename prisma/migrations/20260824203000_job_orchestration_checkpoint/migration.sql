ALTER TABLE "Job"
ADD COLUMN "progress_stage" TEXT,
ADD COLUMN "checkpoint" JSONB;
