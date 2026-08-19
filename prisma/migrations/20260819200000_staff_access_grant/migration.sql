-- A pre-authorized email, entitled to become staff on first verified sign-in — no token, no
-- link. See the model comment in schema.prisma for why this is a separate table from
-- StaffInvitation rather than a tokenless row inside it.

CREATE TYPE "StaffAccessGrantStatus" AS ENUM ('pending', 'claimed', 'revoked');

CREATE TABLE "StaffAccessGrant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'agent',
    "status" "StaffAccessGrantStatus" NOT NULL DEFAULT 'pending',
    "granted_by_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claimed_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffAccessGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffAccessGrant_claimed_user_id_key" ON "StaffAccessGrant"("claimed_user_id");
CREATE INDEX "StaffAccessGrant_email_status_idx" ON "StaffAccessGrant"("email", "status");

ALTER TABLE "StaffAccessGrant" ADD CONSTRAINT "StaffAccessGrant_granted_by_id_fkey"
    FOREIGN KEY ("granted_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffAccessGrant" ADD CONSTRAINT "StaffAccessGrant_revoked_by_id_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffAccessGrant" ADD CONSTRAINT "StaffAccessGrant_claimed_user_id_fkey"
    FOREIGN KEY ("claimed_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Narrower than StaffInvitation's role CHECK on purpose: only `agent` may be pre-authorized
-- this way. An unattended claim landing on ops/admin the instant somebody's verified email
-- happens to match is a far more dangerous default than requiring a human to accept a link
-- for those roles.
ALTER TABLE "StaffAccessGrant" ADD CONSTRAINT "StaffAccessGrant_role_is_agent" CHECK (
    "role"::text = 'agent'
);

-- Claimed rows must record who and when; unclaimed rows must not. Same reasoning as
-- StaffInvitation_accepted_shape: prevents a half-written claim from being presented twice.
ALTER TABLE "StaffAccessGrant" ADD CONSTRAINT "StaffAccessGrant_claimed_shape" CHECK (
    ("status" = 'claimed' AND "claimed_at" IS NOT NULL AND "claimed_user_id" IS NOT NULL)
 OR ("status" <> 'claimed' AND "claimed_at" IS NULL AND "claimed_user_id" IS NULL)
);

ALTER TABLE "StaffAccessGrant" ADD CONSTRAINT "StaffAccessGrant_revoked_shape" CHECK (
    ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
 OR ("status" <> 'revoked' AND "revoked_at" IS NULL)
);

-- At most one live grant per email. Partial index rather than a plain unique so an email may
-- be re-granted after a previous grant was revoked or claimed.
CREATE UNIQUE INDEX "StaffAccessGrant_one_pending_per_email"
    ON "StaffAccessGrant"("email") WHERE "status" = 'pending';
