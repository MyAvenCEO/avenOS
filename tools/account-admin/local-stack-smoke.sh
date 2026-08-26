#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly ADMIN_URL="${TEST_ADMIN_DATABASE_URL:-postgres://postgres:aven-dev@127.0.0.1:55432/postgres}"
readonly SUFFIX="${BASHPID}"
readonly DATABASE_NAME="aven_account_admin_smoke_${SUFFIX}"
readonly OPERATOR_ROLE="aven_account_admin_smoke_${SUFFIX}"
readonly OPERATOR_PASSWORD="local-smoke-${SUFFIX}-only"

command -v bun >/dev/null 2>&1 || { printf 'local-stack-smoke: bun is required\n' >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { printf 'local-stack-smoke: psql is required\n' >&2; exit 1; }

DATABASE_URL=$(
	SMOKE_ADMIN_URL="$ADMIN_URL" SMOKE_DATABASE_NAME="$DATABASE_NAME" bun -e '
		const url = new URL(process.env.SMOKE_ADMIN_URL)
		url.pathname = `/${process.env.SMOKE_DATABASE_NAME}`
		url.search = ""
		console.log(url.toString())
	'
)
DB_HOST=$(SMOKE_ADMIN_URL="$ADMIN_URL" bun -e 'console.log(new URL(process.env.SMOKE_ADMIN_URL).hostname)')
DB_PORT=$(SMOKE_ADMIN_URL="$ADMIN_URL" bun -e 'console.log(new URL(process.env.SMOKE_ADMIN_URL).port || "5432")')

cleanup() {
	psql -X --no-psqlrc --set=ON_ERROR_STOP=1 \
		--set=database_name="$DATABASE_NAME" \
		--set=operator_role="$OPERATOR_ROLE" \
		"$ADMIN_URL" >/dev/null <<'SQL' || true
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'database_name' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS :"database_name";
DROP ROLE IF EXISTS :"operator_role";
SQL
}
trap cleanup EXIT INT TERM HUP

psql -X --no-psqlrc --set=ON_ERROR_STOP=1 --set=database_name="$DATABASE_NAME" "$ADMIN_URL" \
	>/dev/null <<'SQL'
CREATE DATABASE :"database_name";
SQL

DATABASE_URL="$DATABASE_URL" bun run --cwd "$REPO_ROOT/services/aven-api" db:migrate >/dev/null

psql -X --no-psqlrc --set=ON_ERROR_STOP=1 \
	--set=operator_role="$OPERATOR_ROLE" \
	--set=operator_password="$OPERATOR_PASSWORD" \
	"$DATABASE_URL" >/dev/null <<'SQL'
CREATE ROLE :"operator_role"
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 3
  PASSWORD :'operator_password';
GRANT CONNECT ON DATABASE :"DBNAME" TO :"operator_role";
GRANT USAGE ON SCHEMA public TO :"operator_role";
GRANT SELECT (id, email, name, role, email_verified, created_at, updated_at)
  ON "user" TO :"operator_role";
GRANT UPDATE (role, updated_at)
  ON "user" TO :"operator_role";
GRANT SELECT (id, environment_id, hostname, desired_status, runtime_status)
  ON static_site_bindings TO :"operator_role";
GRANT SELECT (id, owner_user_id, name)
  ON customer_environments TO :"operator_role";
GRANT SELECT (name, status)
  ON names TO :"operator_role";
GRANT INSERT (id, event_type, target_user_id, metadata, created_at)
  ON audit_events TO :"operator_role";

INSERT INTO "user" (id,name,email,email_verified,role,created_at,updated_at)
VALUES ('00000000-0000-4000-8000-000000000090','Smoke Admin','smoke-admin@example.test',true,'admin',now(),now());
INSERT INTO names (name,owner_user_id,status,purchased_at,created_at,updated_at)
VALUES ('adminsmoke','00000000-0000-4000-8000-000000000090','owned',now(),now(),now());
INSERT INTO customer_environments
  (id,owner_user_id,name,database_name,artifact_scope_id,owner_role,stack_name,
   effective_config,status,queued_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000090',
   'adminsmoke','cust_adminsmoke','00000000-0000-4000-8000-000000000094',
   'role_adminsmoke','stack_adminsmoke','{}','ready',now(),now());
INSERT INTO site_repositories
  (id,provider,repository_full_name,clone_url,created_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000092','github','myavenceo/admin-smoke',
   'https://github.com/myavenceo/admin-smoke.git',now(),now());
INSERT INTO static_site_bindings
  (id,environment_id,repository_id,hostname,source_ref,artifact_ref,artifact_path,
   verification_token_hash,desired_status,runtime_status,created_at,updated_at)
VALUES
  ('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000091',
   '00000000-0000-4000-8000-000000000092','aven.ceo','refs/heads/next',
   'refs/heads/deploy/next','dist',repeat('a',64),'active','awaiting_dns',now(),now());
SQL

operator_psql=(
	psql -X --no-psqlrc --set=ON_ERROR_STOP=1
	--host "$DB_HOST"
	--port "$DB_PORT"
	--dbname "$DATABASE_NAME"
	--username "$OPERATOR_ROLE"
)

impact_count=$(
	PGPASSWORD="$OPERATOR_PASSWORD" "${operator_psql[@]}" \
		--tuples-only --no-align --quiet \
		--set=selector="smoke-admin@example.test" \
		--file "$SCRIPT_DIR/sql/impact-count.sql"
)
[[ "$impact_count" == 1 ]] || { printf 'expected one impacted resource, got %s\n' "$impact_count" >&2; exit 1; }

if PGPASSWORD="$OPERATOR_PASSWORD" "${operator_psql[@]}" \
	--set=selector="smoke-admin@example.test" \
	--set=new_role="user" \
	--set=event_type="account.admin.demoted" \
	--set=allow_resource_suspension="false" \
	--file "$SCRIPT_DIR/sql/set-role.sql" >/dev/null 2>&1; then
	printf 'demotion unexpectedly bypassed the resource-impact guard\n' >&2
	exit 1
fi

role_after_refusal=$(
	psql -X --no-psqlrc --tuples-only --no-align --quiet "$DATABASE_URL" \
		--command "SELECT role FROM \"user\" WHERE email='smoke-admin@example.test'"
)
[[ "$role_after_refusal" == admin ]] || { printf 'guarded demotion changed the role\n' >&2; exit 1; }

PGPASSWORD="$OPERATOR_PASSWORD" "${operator_psql[@]}" \
	--set=selector="smoke-admin@example.test" \
	--set=new_role="user" \
	--set=event_type="account.admin.demoted" \
	--set=allow_resource_suspension="true" \
	--file "$SCRIPT_DIR/sql/set-role.sql" >/dev/null

result=$(
	psql -X --no-psqlrc --tuples-only --no-align --field-separator='|' "$DATABASE_URL" \
		--command "SELECT u.role, a.event_type, a.metadata->>'dependentResources', a.metadata->>'resourceSuspensionAcknowledged' FROM \"user\" u JOIN audit_events a ON a.target_user_id=u.id WHERE u.email='smoke-admin@example.test'"
)
[[ "$result" == 'user|account.admin.demoted|1|true' ]] || {
	printf 'unexpected demotion/audit result: %s\n' "$result" >&2
	exit 1
}

if PGPASSWORD="$OPERATOR_PASSWORD" "${operator_psql[@]}" \
	--command "UPDATE \"user\" SET email='forbidden@example.test' WHERE id='00000000-0000-4000-8000-000000000090'" \
	>/dev/null 2>&1; then
	printf 'operator role unexpectedly updated a non-role account column\n' >&2
	exit 1
fi

printf 'account-admin local-stack smoke passed\n'
