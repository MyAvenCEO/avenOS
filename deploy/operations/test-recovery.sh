#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
run_id="aven-recovery-$PPID-$$"
network="$run_id"
source_db="$run_id-source"
target_db="$run_id-target"
image="$run_id:local"
scratch=$(mktemp -d)
cleanup() {
  docker rm --force "$source_db" "$target_db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

mkdir -p "$scratch/repository" "$scratch/source-state" "$scratch/target-state"
chmod 0777 "$scratch/repository" "$scratch/source-state" "$scratch/target-state"
docker build --file "$root/deploy/operations/Dockerfile" --tag "$image" "$root"
[[ "$(docker image inspect --format '{{.Config.User}}' "$image")" == '65532:65532' ]]
docker network create "$network" >/dev/null

start_database() {
  local name=$1
  docker run --detach --name "$name" --network "$network" \
    --env POSTGRES_PASSWORD=recovery-test postgres:17-alpine >/dev/null
  for _ in {1..60}; do
    # The official image first starts an initialization server on its Unix socket,
    # stops it, and only then starts the durable server on TCP. A socket-only probe
    # can succeed during that transition and race the first createdb command.
    if docker exec "$name" pg_isready --host 127.0.0.1 --username postgres \
      --dbname postgres >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "database did not become ready: $name" >&2
  return 1
}

start_database "$source_db"
docker exec "$source_db" createdb --username postgres aven_identity
docker exec "$source_db" createdb --username postgres customer_00000000_0000_4000_8000_000000000001
docker exec "$source_db" psql --username postgres --command \
  "CREATE ROLE aven_backup LOGIN INHERIT PASSWORD 'backup-test'; CREATE ROLE app_reader LOGIN PASSWORD 'source-password'; CREATE ROLE customer_owner NOLOGIN; ALTER DATABASE customer_00000000_0000_4000_8000_000000000001 OWNER TO customer_owner; GRANT pg_read_all_data TO aven_backup; GRANT CONNECT ON DATABASE aven_identity TO aven_backup,app_reader; GRANT CONNECT ON DATABASE customer_00000000_0000_4000_8000_000000000001 TO aven_backup;" >/dev/null
docker exec "$source_db" psql --username postgres --dbname aven_identity --command \
  "CREATE TABLE credentials(id uuid PRIMARY KEY, label text NOT NULL); INSERT INTO credentials VALUES ('00000000-0000-4000-8000-000000000001','first passkey'); GRANT SELECT ON credentials TO app_reader;" >/dev/null
docker exec "$source_db" psql --username postgres \
  --dbname customer_00000000_0000_4000_8000_000000000001 --command \
  "CREATE SCHEMA intent; CREATE TABLE intent.entries(id uuid PRIMARY KEY, body jsonb NOT NULL); INSERT INTO intent.entries VALUES ('00000000-0000-4000-8000-000000000002','{\"kind\":\"chat\"}');" >/dev/null
docker exec "$source_db" psql --username postgres \
  --dbname customer_00000000_0000_4000_8000_000000000001 --command \
  'ALTER SCHEMA intent OWNER TO customer_owner; ALTER TABLE intent.entries OWNER TO customer_owner;' >/dev/null
backup_inherits=$(docker exec "$source_db" psql --username postgres --tuples-only --no-align \
  --command "SELECT rolinherit FROM pg_roles WHERE rolname='aven_backup'")
[[ "$backup_inherits" == 't' ]]
if docker exec --env PGPASSWORD=backup-test "$source_db" psql --host 127.0.0.1 \
  --username aven_backup --dbname aven_identity --command \
  "INSERT INTO credentials VALUES ('00000000-0000-4000-8000-000000000099','forbidden')"; then
  echo 'backup role unexpectedly wrote application data' >&2
  exit 1
fi

common=(
  --rm --network "$network" --user "$(id -u):$(id -g)"
  --env RESTIC_REPOSITORY=/repository --env RESTIC_PASSWORD=recovery-encryption-test
  --env XDG_CACHE_HOME=/tmp/restic-cache
  --volume "$scratch/repository:/repository"
)
docker run "${common[@]}" --env PGHOST="$source_db" --env PGUSER=aven_backup --env PGPASSWORD=backup-test \
  --env BACKUP_ENVIRONMENT=ci --env BACKUP_HOST=restore-drill-source \
  --volume "$scratch/source-state:/var/lib/aven-backups" "$image" backup
docker run "${common[@]}" --env PGHOST="$source_db" --env PGUSER=aven_backup --env PGPASSWORD=backup-test \
  --volume "$scratch/source-state:/var/lib/aven-backups" "$image" health

start_database "$target_db"
if docker run "${common[@]}" --env PGHOST="$target_db" --env PGUSER=postgres --env PGPASSWORD=recovery-test \
  --env BACKUP_ENVIRONMENT=production --env RESTORE_CONFIRMATION=fresh-target-only \
  --volume "$scratch/target-state:/var/lib/aven-backups" "$image" restore; then
  echo 'restore unexpectedly accepted another environment snapshot' >&2
  exit 1
fi
docker run "${common[@]}" --env PGHOST="$target_db" --env PGUSER=postgres --env PGPASSWORD=recovery-test \
  --env BACKUP_ENVIRONMENT=ci --env RESTORE_CONFIRMATION=fresh-target-only \
  --volume "$scratch/target-state:/var/lib/aven-backups" "$image" restore

identity_label=$(docker exec "$target_db" psql --username postgres --dbname aven_identity \
  --tuples-only --no-align --command 'SELECT label FROM credentials')
intent_kind=$(docker exec "$target_db" psql --username postgres \
  --dbname customer_00000000_0000_4000_8000_000000000001 \
  --tuples-only --no-align --command "SELECT body->>'kind' FROM intent.entries")
restored_owner=$(docker exec "$target_db" psql --username postgres \
  --dbname customer_00000000_0000_4000_8000_000000000001 \
  --tuples-only --no-align --command "SELECT tableowner FROM pg_tables WHERE schemaname='intent' AND tablename='entries'")
restored_reader=$(docker exec "$target_db" psql --username postgres --dbname aven_identity \
  --tuples-only --no-align --command \
  "SELECT (NOT rolcanlogin) AND has_table_privilege('app_reader','credentials','SELECT') FROM pg_roles WHERE rolname='app_reader'")
[[ "$identity_label" == 'first passkey' ]]
[[ "$intent_kind" == 'chat' ]]
[[ "$restored_owner" == 'customer_owner' ]]
[[ "$restored_reader" == 't' ]]

if docker run "${common[@]}" --env PGHOST="$target_db" --env PGUSER=postgres --env PGPASSWORD=recovery-test \
  --env BACKUP_ENVIRONMENT=ci --env RESTORE_CONFIRMATION=fresh-target-only \
  --volume "$scratch/target-state:/var/lib/aven-backups" "$image" restore; then
  echo 'restore unexpectedly overwrote a populated target' >&2
  exit 1
fi
if docker run "${common[@]}" --env PGHOST="$target_db" --env PGUSER=postgres --env PGPASSWORD=recovery-test \
  --env RESTIC_PASSWORD=wrong-password \
  --env BACKUP_ENVIRONMENT=ci --env RESTORE_CONFIRMATION=fresh-target-only \
  --volume "$scratch/target-state:/var/lib/aven-backups" "$image" restore; then
  echo 'restore unexpectedly accepted the wrong encryption key' >&2
  exit 1
fi

echo 'destructive backup/restore drill passed'
