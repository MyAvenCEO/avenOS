ALTER TABLE customer_environments
  ADD COLUMN artifact_store_schema_version integer DEFAULT 0 NOT NULL
  CHECK (artifact_store_schema_version >= 0);
