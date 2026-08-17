#!/usr/bin/env bash
set -euo pipefail
: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL is required}"
: "${RESTORE_DRILL_DATABASE_URL:?RESTORE_DRILL_DATABASE_URL is required}"
case "$RESTORE_DRILL_DATABASE_URL" in *restore_drill*) ;; *) echo "Refusing target without restore_drill in its URL" >&2; exit 2;; esac
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$tmp_dir/source.dump" "$DIRECT_DATABASE_URL"
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DRILL_DATABASE_URL" "$tmp_dir/source.dump"
psql "$RESTORE_DRILL_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT COUNT(*) AS migration_count FROM "_prisma_migrations";' -c 'SELECT COUNT(*) AS user_count FROM "User";'
echo "Restore drill passed. Drop or recycle the isolated restore-drill database now."
