# Account administration

This operator tool lists identity accounts and changes the canonical account role between `user` and `admin`. It reaches PostgreSQL only through the same restricted local SSH forwarding model as the [database tunnel](../db-tunnel/README.md).

An admin role is returned with every authoritative Better Auth session. The API uses it to permit static-site bindings below `.aven.ceo`; the `aven.ceo` apex remains reserved.

## Security model

- The public API has no operator role-mutation endpoint.
- SSH permits local forwarding only to PostgreSQL on `127.0.0.1:55432`; it provides no shell or PTY.
- Use one named SSH identity and one named PostgreSQL role per operator and environment.
- The PostgreSQL role can read only the account summary columns, update only `user.role` and `user.updated_at`, and append the bounded audit-event columns.
- The database constraint accepts only `user` and `admin`.
- Every mutation records the PostgreSQL operator role, previous role, new role, target account, and timestamp in `audit_events`.
- Demotion inventories admin-dependent resources first. If any active `.aven.ceo` site depends on the role, the command fails unless the operator separately acknowledges resource suspension.
- Profile files are local, ignored, and must have mode `0400` or `0600`.

## Requirements

- Apply API migration `0020_account_admin_role` before using the tool.
- Install Bash, OpenSSH, and `psql` locally.
- Complete the database tunnel's host-key and restricted SSH-account setup. The same per-operator tunnel identity may be used because its destination restriction is identical.
- Create the separate column-restricted PostgreSQL role below.

## Create an operator database role

Open an administrative PostgreSQL session as described in the database tunnel setup. Replace `daniel` with the individual operator name:

```sql
CREATE ROLE aven_account_admin_daniel
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  CONNECTION LIMIT 3;

ALTER ROLE aven_account_admin_daniel SET statement_timeout = '10s';
ALTER ROLE aven_account_admin_daniel SET lock_timeout = '3s';

GRANT CONNECT ON DATABASE aven TO aven_account_admin_daniel;
GRANT USAGE ON SCHEMA public TO aven_account_admin_daniel;
GRANT SELECT (id, email, name, role, email_verified, created_at, updated_at)
  ON "user" TO aven_account_admin_daniel;
GRANT UPDATE (role, updated_at)
  ON "user" TO aven_account_admin_daniel;
GRANT SELECT (id, environment_id, hostname, desired_status, runtime_status)
  ON static_site_bindings TO aven_account_admin_daniel;
GRANT SELECT (id, owner_user_id, name)
  ON customer_environments TO aven_account_admin_daniel;
GRANT SELECT (name, status)
  ON names TO aven_account_admin_daniel;
GRANT INSERT (id, event_type, target_user_id, metadata, created_at)
  ON audit_events TO aven_account_admin_daniel;

\password aven_account_admin_daniel
```

The final command prompts without placing the password in shell history. Do not grant table-wide `UPDATE`, access to sessions/passkeys, or membership in an application runtime role.

Verify the effective column grants:

```sql
SELECT table_name, privilege_type, string_agg(column_name, ', ' ORDER BY column_name) AS columns
FROM information_schema.column_privileges
WHERE grantee = 'aven_account_admin_daniel'
  AND table_schema = 'public'
GROUP BY table_name, privilege_type
ORDER BY table_name, privilege_type;
```

## Configure a local profile

```sh
cp tools/account-admin/.env.example tools/account-admin/.env.next
chmod 600 tools/account-admin/.env.next
```

Set the same restricted SSH identity and pinned known-hosts file used for that environment, but use the dedicated account-administration PostgreSQL role and password:

```dotenv
SSH_HOST=id.next.aven.ceo
SSH_PORT=22
SSH_USER=aven-db-daniel
SSH_IDENTITY_FILE=/home/daniel/.ssh/aven/id_next_db_tunnel
SSH_KNOWN_HOSTS_FILE=/home/daniel/.ssh/aven/id_next_known_hosts

LOCAL_DB_PORT=55434
REMOTE_DB_HOST=127.0.0.1
REMOTE_DB_PORT=55432

PGDATABASE=aven
PGUSER=aven_account_admin_daniel
PGPASSWORD=the-account-admin-database-password
```

Use a different local port from a foreground database tunnel. Private keys and their passphrases never belong in the profile.

## Use the tool

List all accounts:

```sh
./tools/account-admin/account-admin.sh next list
```

Promote by exact email or user ID:

```sh
./tools/account-admin/account-admin.sh next promote owner@example.com
```

Remove admin status:

```sh
./tools/account-admin/account-admin.sh next demote owner@example.com
```

Demotion has an availability consequence: every active `.aven.ceo` site owned by that account disappears from the authenticated host directory on its next reconciliation. The binding and artifacts are retained, but Caddy authorization is withdrawn and the site is offline. The tool lists all affected resources and refuses the operation by default. After reviewing the list, explicitly acknowledge the suspension:

```sh
./tools/account-admin/account-admin.sh next demote owner@example.com \
  --allow-resource-suspension
```

For impacted accounts, the interactive confirmation includes the exact affected count, for example `demote and suspend 2 resources`. Re-promoting the same account restores eligible bindings on the next host reconciliation; DNS and repository state must still be valid.

The tool displays the exact target and asks for a typed confirmation. Automation may pass `--yes` only after independently resolving the target. `--yes` does not bypass the resource-impact guard:

```sh
./tools/account-admin/account-admin.sh next promote owner@example.com --yes
./tools/account-admin/account-admin.sh next demote owner@example.com \
  --allow-resource-suspension --yes
```

Omitting the profile selects `next`. Keep independent `.env.next` and `.env.production` files and credentials.

## Revoke access

Disable the PostgreSQL login and terminate active sessions:

```sql
ALTER ROLE aven_account_admin_daniel NOLOGIN;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'aven_account_admin_daniel'
  AND pid <> pg_backend_pid();
```

Then revoke or rotate the restricted SSH key as described by the database tunnel documentation. Audit rows remain append-only to this operator role.

## Local-stack verification

Start the local PostgreSQL/API stack, which publishes PostgreSQL only on loopback:

```sh
docker compose -f services/aven-api/docker-compose.yml up -d db
bun run db:migrate:api
```

Run the cross-service lifecycle, static-host, and least-privilege SQL smoke suites:

```sh
bun run --cwd services/aven-api vitest run tests/sites-admin-lifecycle.test.ts
bun run --cwd services/static-site-host test
bun run test:account-admin-local
```

The lifecycle test uses a migrated throwaway database on the local stack and proves promotion, directory authorization, demotion withdrawal, retained binding state, and re-promotion recovery. The static-host suite proves that an API-derived `owner_is_admin: true` is required for `.aven.ceo`, while the apex is always rejected. The operator smoke test creates and removes an isolated database and PostgreSQL role, then proves exact impact reporting, fail-closed demotion, explicit suspension, audit metadata, and denial of updates to non-role account columns.
