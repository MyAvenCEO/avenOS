#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 <<'SQL'
GRANT pg_signal_backend TO aven_provisioner;

SELECT 'CREATE ROLE cust_artifact_local_owner NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cust_artifact_local_owner') \gexec
GRANT cust_artifact_local_owner TO aven_provisioner WITH SET TRUE;

SELECT 'CREATE ROLE aven_artifact_store LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='aven_artifact_store') \gexec
SQL

psql -v ON_ERROR_STOP=1 --set=password="$ARTIFACT_STORE_RUNTIME_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE aven_artifact_store PASSWORD %L', :'password') \gexec
SQL

psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'CREATE DATABASE cust_artifact_local OWNER cust_artifact_local_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='cust_artifact_local') \gexec
REVOKE CONNECT ON DATABASE cust_artifact_local FROM PUBLIC;
GRANT CONNECT ON DATABASE cust_artifact_local TO aven_provisioner, aven_artifact_store;
SQL
