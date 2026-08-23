ALTER TABLE customer_environments
  ADD COLUMN artifact_store_status text DEFAULT 'pending' NOT NULL
  CHECK (artifact_store_status IN ('pending','ready','suspended'));
