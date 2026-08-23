#!/bin/sh
set -eu

root=/opt/aven-api
previous="$root/previous"

for file in .env docker-compose.yml docker-compose.deploy.yml docker-compose.artifact-store.deploy.yml; do
	test -f "$previous/$file" || {
		echo "Previous deployment snapshot is incomplete: $file is missing." >&2
		exit 1
	}
done

install -m 600 "$previous/.env" "$root/.env"
install -m 644 "$previous/docker-compose.yml" "$root/docker-compose.yml"
install -m 644 "$previous/docker-compose.deploy.yml" "$root/docker-compose.deploy.yml"
install -m 644 "$previous/docker-compose.artifact-store.deploy.yml" "$root/docker-compose.artifact-store.deploy.yml"

cd "$root"
compose() {
	docker compose --env-file .env \
		-f docker-compose.yml \
		-f docker-compose.deploy.yml \
		-f docker-compose.artifact-store.deploy.yml "$@"
}

compose pull
compose up -d --remove-orphans --wait --wait-timeout 180 db
compose up -d --remove-orphans --wait --wait-timeout 180 artifact-store-provisioner artifact-store app caddy
compose up -d --remove-orphans email-worker environment-worker

echo "Previous immutable deployment restored. Database migrations were intentionally not reversed."
