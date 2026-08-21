-- StaffInvitation moves from email-bound token invitations to email-less bearer invitations.
--
-- Possession of the raw token is now the entire authorization; there is no invited address to
-- match a claimant against. `email` is kept, made nullable, and never dropped: every row this
-- app creates from here on has email = NULL, but legacy rows created under the old design keep
-- their email for audit/history — they remain queryable and understandable, just no longer
-- compared against anything at acceptance time (see convertUserToAgent in staff-provisioning.ts).

ALTER TABLE "StaffInvitation" ALTER COLUMN "email" DROP NOT NULL;

-- Narrowed from the original ('agent','ops_supervisor','ops_finance','admin') to 'agent' only.
-- No code path has ever issued a StaffInvitation with any other role — the invite route never
-- exposed one — so this only makes explicit in the database a constraint the application already
-- enforced everywhere. It also matches the same narrowing already made for StaffAccessGrant
-- (StaffAccessGrant_role_is_agent): an unattended bearer credential landing on ops/admin would be
-- a materially more dangerous default than requiring that role change go through Ops directly.
ALTER TABLE "StaffInvitation" DROP CONSTRAINT "StaffInvitation_role_is_staff";
ALTER TABLE "StaffInvitation" ADD CONSTRAINT "StaffInvitation_role_is_agent" CHECK (
    "role"::text = 'agent'
);

-- StaffInvitation_one_pending_per_email (unique on "email" WHERE status = 'pending') is
-- DELIBERATELY left untouched. Postgres unique indexes never treat two NULLs as equal, so any
-- number of pending bearer invitations (email IS NULL) may already coexist under this index
-- exactly as the new "generate as many links as you want" flow requires; the index continues to
-- enforce "at most one pending invitation" only for the legacy, non-null-email rows it always
-- applied to. No migration is needed for this rule to have the right shape for both cases.
