CREATE TABLE "site_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"repository_full_name" text NOT NULL UNIQUE,
	"clone_url" text NOT NULL UNIQUE,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_repositories_github_only" CHECK ("provider" = 'github'),
	CONSTRAINT "site_repositories_clone_url_derived" CHECK ("clone_url" = 'https://github.com/' || "repository_full_name" || '.git')
);
--> statement-breakpoint
CREATE TABLE "static_site_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL REFERENCES "customer_environments"("id") ON DELETE CASCADE,
	"repository_id" text NOT NULL REFERENCES "site_repositories"("id"),
	"hostname" text NOT NULL UNIQUE,
	"source_ref" text NOT NULL,
	"artifact_ref" text NOT NULL,
	"artifact_path" text DEFAULT 'dist' NOT NULL,
	"verification_token_hash" text NOT NULL,
	"desired_status" text DEFAULT 'active' NOT NULL,
	"runtime_status" text DEFAULT 'awaiting_dns' NOT NULL,
	"active_artifact_revision" text,
	"active_source_revision" text,
	"last_error" text,
	"verified_at" timestamp with time zone,
	"last_dns_check_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "static_site_bindings_artifact_ref_unique" UNIQUE("repository_id", "artifact_ref"),
	CONSTRAINT "static_site_bindings_artifact_path_dist" CHECK ("artifact_path" = 'dist'),
	CONSTRAINT "static_site_bindings_deployment_ref" CHECK ("artifact_ref" LIKE 'refs/heads/deploy/%'),
	CONSTRAINT "static_site_bindings_token_hash" CHECK ("verification_token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "static_site_bindings_desired_status" CHECK ("desired_status" IN ('active','suspended')),
	CONSTRAINT "static_site_bindings_runtime_status" CHECK ("runtime_status" IN ('awaiting_dns','syncing','active','dns_invalid','failed'))
);
--> statement-breakpoint
CREATE INDEX "static_site_bindings_environment_idx" ON "static_site_bindings" ("environment_id");
--> statement-breakpoint
CREATE INDEX "static_site_bindings_status_idx" ON "static_site_bindings" ("desired_status", "runtime_status");
