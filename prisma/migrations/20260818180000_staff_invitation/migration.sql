-- Staff provisioning: invitations for internal ClearTrade staff.
--
-- A separate table from `Invitation` on purpose. That model is live and exporter-specific by
-- construction — non-null exporter_org_id, cascade delete with the org, both indexes leading
-- with the org, and a working member-invite route and UI depending on it. Adding a `purpose`
-- column and making the org nullable would weaken a running flow and create rows whose meaning
-- depends on reading a NULL correctly. Here there is simply no organisation column to be wrong.

CREATE TYPE "StaffInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

CREATE TABLE "StaffInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "StaffInvitationStatus" NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffInvitation_token_key" ON "StaffInvitation"("token");
CREATE UNIQUE INDEX "StaffInvitation_accepted_user_id_key" ON "StaffInvitation"("accepted_user_id");
CREATE INDEX "StaffInvitation_email_status_idx" ON "StaffInvitation"("email", "status");
CREATE INDEX "StaffInvitation_status_expires_at_idx" ON "StaffInvitation"("status", "expires_at");

ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_invited_by_id_fkey"
    FOREIGN KEY ("invited_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_revoked_by_id_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_accepted_user_id_fkey"
    FOREIGN KEY ("accepted_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A staff invitation may only ever grant a staff role.
--
-- Enforced in the database because this is the privilege-escalation boundary: if a caller ever
-- reached the role field, or a future code path widened it, an exporter role granted through
-- the staff path would create a user with staff powers and no tenant. Phase 4 issues only
-- `agent`; the other staff roles are permitted so an ops invite needs no migration, but an
-- exporter role is refused outright.
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_role_is_staff" CHECK (
    "role"::text IN ('agent', 'ops_supervisor', 'ops_finance', 'admin')
);

-- Accepted rows must record who accepted and when; pending rows must not.
--
-- Prevents a half-written acceptance from reading as a valid one, which would let a token be
-- presented twice: once to create the account and again against a row still marked pending.
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_accepted_shape" CHECK (
    ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "accepted_user_id" IS NOT NULL)
 OR ("status" <> 'accepted' AND "accepted_at" IS NULL AND "accepted_user_id" IS NULL)
);

-- Revoked rows must record when. Same reasoning: a revocation that did not record its timestamp
-- is indistinguishable from an active invitation to anything reading the row directly.
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_revoked_shape" CHECK (
    ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
 OR ("status" <> 'revoked' AND "revoked_at" IS NULL)
);

-- At most one live invitation per email. Partial index rather than a plain unique so a person
-- may be re-invited after a previous invitation was revoked or expired.
CREATE UNIQUE INDEX "StaffInvitation_one_pending_per_email"
    ON "StaffInvitation"("email") WHERE "status" = 'pending';
