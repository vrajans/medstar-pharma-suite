#!/usr/bin/env bash
# Runs migrations + seed + DB test pack against a throwaway database.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=medstar_test_$$
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
run() { psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"; }
run supabase/tests/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
for t in supabase/tests/[1-9]*.sql; do run "$t"; done
