-- Read-side access paths; immutable documents and their lineage are unchanged.
CREATE INDEX artifact_contents_type_idx
    ON artifact_store.artifact_contents(scope_id, type_key, artifact_id);
CREATE INDEX artifact_run_inputs_source_idx
    ON artifact_store.artifact_run_inputs(scope_id, input_artifact_id, run_id);
CREATE INDEX artifact_records_producer_idx
    ON artifact_store.artifact_records(scope_id, producer_run_id, id);
