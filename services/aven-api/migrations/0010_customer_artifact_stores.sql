ALTER TABLE customer_environments ADD COLUMN artifact_scope_id text;
--> statement-breakpoint
UPDATE customer_environments SET artifact_scope_id=id WHERE artifact_scope_id IS NULL;
--> statement-breakpoint
ALTER TABLE customer_environments ALTER COLUMN artifact_scope_id SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX customer_environments_artifact_scope_unique
  ON customer_environments(artifact_scope_id);
--> statement-breakpoint
UPDATE customer_environments
SET contract_version=2,
    effective_config=effective_config || jsonb_build_object(
      'contractVersion', 2,
      'artifactStore', jsonb_build_object(
        'schemaVersion', 1,
        'scopeId', artifact_scope_id
      )
    ),
    updated_at=now();
