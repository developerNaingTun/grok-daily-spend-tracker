#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_container="together-spend-db-test-$$"
cleanup() { docker rm -f "$test_container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --name "$test_container" --rm -d -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null
for attempt in {1..30}; do
  if docker exec "$test_container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 30 ]; then echo 'PostgreSQL failed readiness' >&2; exit 1; fi
  sleep 1
done
for sql_file in tests/bootstrap.sql supabase/migrations/001_household_ledger.sql tests/database.sql; do
  docker exec -i "$test_container" psql -U postgres -v ON_ERROR_STOP=1 < "$sql_file"
done
