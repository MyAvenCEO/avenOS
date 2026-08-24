ALTER TABLE customer_environments
    ADD COLUMN intent_service_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN intent_service_schema_version integer NOT NULL DEFAULT 0;

ALTER TABLE customer_environments
    ADD CONSTRAINT customer_environments_intent_service_status_check
        CHECK (intent_service_status IN ('pending', 'ready', 'suspended')),
    ADD CONSTRAINT customer_environments_intent_service_schema_version_check
        CHECK (intent_service_schema_version >= 0);

CREATE INDEX customer_environments_intent_service_directory_idx
    ON customer_environments(intent_service_status, intent_service_schema_version, id);
