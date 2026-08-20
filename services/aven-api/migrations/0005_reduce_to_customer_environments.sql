DROP TABLE IF EXISTS agent_grants CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS app_handoffs CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS task_secrets CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS job_logs CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS jobs CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS tasks CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS requests CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS support_recovery_codes CASCADE;
--> statement-breakpoint
ALTER TABLE audit_events DROP COLUMN IF EXISTS request_id;
--> statement-breakpoint
ALTER TABLE audit_events DROP COLUMN IF EXISTS task_id;
--> statement-breakpoint
ALTER TABLE audit_events DROP COLUMN IF EXISTS job_id;
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS role;
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS banned;
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS ban_reason;
--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN IF EXISTS ban_expires;
--> statement-breakpoint
ALTER TABLE "session" DROP COLUMN IF EXISTS impersonated_by;
--> statement-breakpoint
ALTER TABLE passkey ADD COLUMN IF NOT EXISTS prf_enabled boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  checkout_id text,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  processed_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_events_checkout_idx ON payment_events(checkout_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customer_environments (
  id text PRIMARY KEY,
  owner_user_id text NOT NULL REFERENCES "user"(id),
  name text NOT NULL UNIQUE REFERENCES names(name),
  database_name text NOT NULL UNIQUE,
  owner_role text NOT NULL UNIQUE,
  stack_name text NOT NULL UNIQUE,
  contract_version integer DEFAULT 1 NOT NULL,
  effective_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','provisioning','ready','suspended','failed')),
  last_operation text,
  last_error_code text,
  last_error_message text,
  queued_at timestamp with time zone NOT NULL,
  provisioning_at timestamp with time zone,
  ready_at timestamp with time zone,
  suspended_at timestamp with time zone,
  failed_at timestamp with time zone,
  updated_at timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_environments_owner_idx ON customer_environments(owner_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_environments_status_idx ON customer_environments(status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customer_environment_jobs (
  id text PRIMARY KEY,
  environment_id text NOT NULL REFERENCES customer_environments(id),
  operation text NOT NULL CHECK (operation IN ('provision','suspend')),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  attempt integer DEFAULT 0 NOT NULL,
  available_at timestamp with time zone NOT NULL,
  lease_owner text,
  lease_expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  error_code text,
  error_message text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS customer_environment_jobs_claim_idx ON customer_environment_jobs(status, available_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS customer_environment_jobs_one_unfinished
  ON customer_environment_jobs(environment_id) WHERE status IN ('queued','running');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS customer_environment_logs (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES customer_environment_jobs(id),
  sequence integer NOT NULL,
  level text NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  CONSTRAINT customer_environment_logs_job_sequence_unique UNIQUE(job_id, sequence)
);
