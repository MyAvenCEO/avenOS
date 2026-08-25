#!/bin/sh
set -eu

root=/opt/aven-api
previous="$root/previous"

for file in .env docker-compose.yml docker-compose.deploy.yml docker-compose.artifact-store.deploy.yml Caddyfile; do
	test -f "$previous/$file" || {
		echo "Previous deployment snapshot is incomplete: $file is missing." >&2
		exit 1
	}
done

install -m 600 "$previous/.env" "$root/.env"
install -m 644 "$previous/docker-compose.yml" "$root/docker-compose.yml"
install -m 644 "$previous/docker-compose.deploy.yml" "$root/docker-compose.deploy.yml"
install -m 644 "$previous/docker-compose.artifact-store.deploy.yml" "$root/docker-compose.artifact-store.deploy.yml"
install -m 644 "$previous/Caddyfile" "$root/deploy/Caddyfile"

cd "$root"
compose() {
	docker compose --env-file .env \
		-f docker-compose.yml \
		-f docker-compose.deploy.yml \
		-f docker-compose.artifact-store.deploy.yml "$@"
}

compose pull
compose up -d --remove-orphans --wait --wait-timeout 180 db

# Processor schema 5 revokes the current runtime from the empty prototype intent
# schema. The previous Processor image still opens those tables, so restore only
# that old grant while rolling back. The current Compose file has no Intent Service;
# --remove-orphans removes its containers without naming unknown services here.
for database_name in $(compose exec -T db psql -U postgres -d postgres -Atc \
	"SELECT datname FROM pg_database WHERE datname ~ '^cust_[a-z0-9_]+$' ORDER BY datname"); do
	compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$database_name" <<'SQL'
DO $$
BEGIN
	IF to_regnamespace('aven_intents') IS NOT NULL
		AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aven_artifact_processor') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA aven_intents TO aven_artifact_processor';
		EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA aven_intents TO aven_artifact_processor';
	END IF;
END
$$;
SQL
done

compose up -d --remove-orphans --wait --wait-timeout 180 artifact-store-provisioner artifact-store artifact-processor-provisioner artifact-processor app caddy
"$root/deploy/reload-caddy.sh"
compose up -d --remove-orphans email-worker environment-worker

echo "Previous immutable deployment restored. Database migrations were intentionally not reversed."
