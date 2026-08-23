ALTER TABLE customer_environments
  ADD COLUMN artifact_processor_status text DEFAULT 'pending' NOT NULL
  CHECK (artifact_processor_status IN ('pending','ready','suspended')),
  ADD COLUMN artifact_processor_schema_version integer DEFAULT 0 NOT NULL
  CHECK (artifact_processor_schema_version >= 0);
