-- Conversation chronology and work order are different after an edit. Preserve
-- immutable messages while putting a replacement in its predecessor's FIFO slot.
ALTER TABLE aven_intents.turn_outbox
  ADD COLUMN queue_position bigint,
  ADD COLUMN queue_revision integer NOT NULL DEFAULT 1 CHECK (queue_revision > 0),
  ADD COLUMN replaces_turn_id uuid UNIQUE REFERENCES aven_intents.turn_outbox(turn_id) ON DELETE RESTRICT;
UPDATE aven_intents.turn_outbox SET queue_position=sequence;
ALTER TABLE aven_intents.turn_outbox
  ALTER COLUMN queue_position SET NOT NULL,
  ADD CHECK (queue_position > 0),
  ADD CONSTRAINT turn_outbox_queue_order UNIQUE(intent_id,queue_position,queue_revision);
CREATE INDEX turn_outbox_queue_barrier ON aven_intents.turn_outbox(intent_id,queue_position,queue_revision)
WHERE state IN ('pending','dispatched','blocked');
DROP INDEX aven_intents.turn_outbox_unfinished;
