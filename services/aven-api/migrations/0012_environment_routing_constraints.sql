ALTER TABLE customer_environments
  ADD CONSTRAINT customer_environments_database_name_safe
  CHECK (length(database_name) <= 63 AND database_name ~ '^cust_[a-z0-9_]+$');
--> statement-breakpoint
ALTER TABLE customer_environments
  ADD CONSTRAINT customer_environments_owner_role_safe
  CHECK (length(owner_role) <= 63 AND owner_role ~ '^[a-z][a-z0-9_]*$');
--> statement-breakpoint
ALTER TABLE customer_environments
  ADD CONSTRAINT customer_environments_artifact_scope_uuid
  CHECK (artifact_scope_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
