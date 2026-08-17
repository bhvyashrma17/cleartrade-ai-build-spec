ALTER TYPE "JobType" ADD VALUE 'notification_delivery';
CREATE TYPE "NotificationChannel" AS ENUM ('email');
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('queued','retrying','sent','delivered','failed','bounced','rejected','suppressed');

CREATE TABLE "NotificationDelivery" (
  "id" TEXT PRIMARY KEY,"notification_id" TEXT NOT NULL,"channel" "NotificationChannel" NOT NULL,
  "destination_reference" TEXT NOT NULL,"template_key" TEXT NOT NULL,"template_version" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL DEFAULT 'queued',"attempt_count" INTEGER NOT NULL DEFAULT 0,
  "provider" TEXT,"provider_message_id" TEXT,"queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),"delivered_at" TIMESTAMP(3),"failed_at" TIMESTAMP(3),"next_retry_at" TIMESTAMP(3),
  "last_error_code" TEXT,"last_error_message" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDelivery_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "Notification"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "NotificationDelivery_notification_id_channel_key" ON "NotificationDelivery"("notification_id","channel");
CREATE INDEX "NotificationDelivery_status_next_retry_at_idx" ON "NotificationDelivery"("status","next_retry_at");
CREATE TABLE "NotificationDeliveryAttempt" (
  "id" TEXT PRIMARY KEY,"delivery_id" TEXT NOT NULL,"attempt_no" INTEGER NOT NULL,"provider" TEXT NOT NULL,
  "status" "NotificationDeliveryStatus" NOT NULL,"provider_message_id" TEXT,"error_code" TEXT,"error_message" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"finished_at" TIMESTAMP(3),
  CONSTRAINT "NotificationDeliveryAttempt_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "NotificationDelivery"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_delivery_id_attempt_no_key" ON "NotificationDeliveryAttempt"("delivery_id","attempt_no");

CREATE FUNCTION enqueue_notification_delivery() RETURNS trigger AS $$
DECLARE job_id TEXT := 'notif_' || md5(NEW.id || clock_timestamp()::text);
BEGIN
  INSERT INTO "Job" ("id","type","status","dedupe_key","payload","target_type","target_id","max_attempts","run_after","correlation_id","created_at","updated_at")
  VALUES (job_id,'notification_delivery','queued','notification-delivery:' || NEW.id,jsonb_build_object('notification_id',NEW.id),'notification',NEW.id,3,CURRENT_TIMESTAMP,job_id,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Notification_enqueue_delivery" AFTER INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION enqueue_notification_delivery();
