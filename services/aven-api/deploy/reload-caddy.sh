#!/bin/sh
set -eu

root=/opt/aven-api
cd "$root"

compose() {
	docker compose --env-file .env \
		-f docker-compose.yml \
		-f docker-compose.deploy.yml \
		-f docker-compose.artifact-store.deploy.yml "$@"
}

# The deployment replaces the host-side Caddyfile. A running file bind mount can
# remain attached to the previous inode, so feed the installed file over stdin
# instead of asking Caddy to reopen /etc/caddy/Caddyfile inside the container.
compose exec -T caddy caddy reload \
	--config - \
	--adapter caddyfile \
	--force <deploy/Caddyfile
