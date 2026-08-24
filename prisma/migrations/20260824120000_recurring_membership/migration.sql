-- Recurring membership (Subscription) — the paid tier becomes time-bounded.
--
-- Backfill posture: existing `paid` orgs got there via the one-time commitment fee, which
-- does not expire. They are left with `paid_until = NULL`, which `syncTierFromSubscription`
-- reads as "non-expiring grant" — so this migration cannot revoke access from anyone who
-- already has it. That is deliberate: a membership migration that silently downgrades
-- paying tenants is the worst possible failure mode here.

CREATE TYPE "SubscriptionPlanCode" AS ENUM ('premium_monthly', 'premium_annual');

CREATE TYPE "SubscriptionStatus" AS ENUM (
  'none', 'created', 'authenticated', 'active', 'pending',
  'halted', 'cancelled', 'completed', 'expired'
);

CREATE TYPE "SubscriptionProvider" AS ENUM ('razorpay', 'manual');

ALTER TABLE "ExporterOrg"
  ADD COLUMN "paid_until" TIMESTAMP(3),
  ADD COLUMN "downgraded_at" TIMESTAMP(3);

CREATE TABLE "Subscription" (
  "id" TEXT NOT NULL,
  "exporter_org_id" TEXT NOT NULL,
  "plan_code" "SubscriptionPlanCode" NOT NULL,
  "provider" "SubscriptionProvider" NOT NULL DEFAULT 'razorpay',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'created',
  "provider_subscription_id" TEXT,
  "provider_customer_id" TEXT,
  "provider_plan_id" TEXT,
  "amount" DECIMAL(18,4) NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "cancelled_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "short_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionEvent" (
  "id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "provider_event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "resulting_status" "SubscriptionStatus" NOT NULL,
  "payload" JSONB NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- A webhook is dispatched by provider subscription id and must resolve to exactly one row.
CREATE UNIQUE INDEX "Subscription_provider_subscription_id_key"
  ON "Subscription"("provider_subscription_id");
CREATE INDEX "Subscription_exporter_org_id_created_at_idx"
  ON "Subscription"("exporter_org_id", "created_at");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- THIS is the idempotency control: a replayed Razorpay delivery is rejected by the
-- database, not by application logic that could race with a concurrent delivery.
CREATE UNIQUE INDEX "SubscriptionEvent_provider_event_id_key"
  ON "SubscriptionEvent"("provider_event_id");
CREATE INDEX "SubscriptionEvent_subscription_id_received_at_idx"
  ON "SubscriptionEvent"("subscription_id", "received_at");

-- Drives the lapse sweep: "paid orgs whose clock has run out".
CREATE INDEX "ExporterOrg_tier_paid_until_idx" ON "ExporterOrg"("tier", "paid_until");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_exporter_org_id_fkey"
  FOREIGN KEY ("exporter_org_id") REFERENCES "ExporterOrg"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEvent"
  ADD CONSTRAINT "SubscriptionEvent_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Money is amount + currency everywhere in this schema; a zero/negative recurring charge
-- is not a membership, and an ISO-4217 code is three letters.
ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "Subscription_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$'),
  -- A period that ends before it starts would put `paid_until` in the past on day one.
  ADD CONSTRAINT "Subscription_period_ordered"
  CHECK ("current_period_start" IS NULL OR "current_period_end" IS NULL
         OR "current_period_end" >= "current_period_start"),
  -- Only an Ops-granted membership may have no gateway object behind it. A `razorpay` row
  -- without a provider id is an orphan that no webhook can ever reach.
  ADD CONSTRAINT "Subscription_gateway_row_has_provider_id"
  CHECK ("provider" = 'manual' OR "provider_subscription_id" IS NOT NULL);
