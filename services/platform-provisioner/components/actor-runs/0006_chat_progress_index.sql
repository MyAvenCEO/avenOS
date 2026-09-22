-- Progress reads use the admitted turn identity, never a caller-selected journal.
CREATE INDEX actor_runs_chat_turn_subject_idx
  ON aven_actor_runs.runs(subject_id, (record->>'skillRef'), (record#>>'{parameters,turnId}'))
  WHERE record#>>'{parameters,turnId}' IS NOT NULL;
