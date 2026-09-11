#!/usr/bin/env bash
set -euo pipefail
: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL is required}"
npx tsx scripts/database-identity-check.ts
backup_dir="${BACKUP_DIRECTORY:-./.data/backups}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$backup_dir/cleartrade-$stamp.dump"
pg_dump --format=custom --no-owner --no-acl --file="$target" "$DIRECT_DATABASE_URL"
sha256sum "$target" > "$target.sha256"
echo "Backup written to $target (store it in encrypted, access-controlled object storage)."
