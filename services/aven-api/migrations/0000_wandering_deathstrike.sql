CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proof_of_work_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"purpose" text NOT NULL,
	"difficulty_bits" integer NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone NOT NULL,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "setup_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "setup_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "support_recovery_codes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "support_recovery_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"decision_reason" text,
	"reviewed_by_user_id" text,
	"task_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"reviewed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"status" text NOT NULL,
	"attempt" integer NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"task_type" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_user_id" text NOT NULL,
	"approved_by_user_id" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "tasks_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "email_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"template_key" text NOT NULL,
	"to_address" text NOT NULL,
	"payload_encrypted" text,
	"status" text NOT NULL,
	"priority" integer NOT NULL,
	"attempts" integer NOT NULL,
	"max_attempts" integer NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"idempotency_key" text,
	"last_error_code" text,
	"last_error_message" text,
	"smtp_message_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"dead_at" timestamp with time zone,
	CONSTRAINT "email_queue_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "name_holds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"claim_token_hash" text DEFAULT '' NOT NULL,
	"success_token_hash" text DEFAULT '' NOT NULL,
	"email_confirmed_at" timestamp with time zone,
	"reserved_until" timestamp with time zone,
	"checkout_id" text,
	"checkout_url" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "names" (
	"name" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"status" text NOT NULL,
	"checkout_id" text,
	"order_id" text,
	"price_paid_eur" numeric,
	"purchased_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"target_user_id" text,
	"request_id" text,
	"task_id" text,
	"job_id" text,
	"email_queue_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_name" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_links" ADD CONSTRAINT "setup_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_recovery_codes" ADD CONSTRAINT "support_recovery_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_logs" ADD CONSTRAINT "job_logs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "names" ADD CONSTRAINT "names_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_sessions" ADD CONSTRAINT "purchase_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proof_of_work_challenges_expiry_idx" ON "proof_of_work_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "proof_of_work_challenges_used_idx" ON "proof_of_work_challenges" USING btree ("used_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_unique" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "requests_user_id_idx" ON "requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_logs_job_sequence_unique" ON "job_logs" USING btree ("job_id","sequence");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_unfinished_per_task" ON "jobs" USING btree ("task_id") WHERE "jobs"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "tasks_owner_idx" ON "tasks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_created_at_idx" ON "tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_queue_claim_idx" ON "email_queue" USING btree ("status","available_at","priority");--> statement-breakpoint
CREATE INDEX "email_queue_created_idx" ON "email_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_queue_to_idx" ON "email_queue" USING btree ("to_address");--> statement-breakpoint
CREATE INDEX "email_queue_template_idx" ON "email_queue" USING btree ("template_key");--> statement-breakpoint
CREATE INDEX "name_holds_name_idx" ON "name_holds" USING btree ("name");--> statement-breakpoint
CREATE INDEX "name_holds_expiry_idx" ON "name_holds" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "name_holds_email_idx" ON "name_holds" USING btree ("email");--> statement-breakpoint
CREATE INDEX "name_holds_claim_token_idx" ON "name_holds" USING btree ("claim_token_hash");--> statement-breakpoint
CREATE INDEX "name_holds_reserved_idx" ON "name_holds" USING btree ("reserved_until");--> statement-breakpoint
CREATE INDEX "names_owner_idx" ON "names" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "names_status_idx" ON "names" USING btree ("status");--> statement-breakpoint
CREATE INDEX "names_checkout_idx" ON "names" USING btree ("checkout_id");