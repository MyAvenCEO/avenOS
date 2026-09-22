-- Fair, bounded supervision does not scan completed history or keep selecting
-- the same long-running jobs at the front of the queue.
CREATE INDEX turn_outbox_supervision ON aven_intents.turn_outbox(available_at,turn_id)
WHERE state='dispatched' OR (state='blocked' AND stop_requested_at IS NOT NULL);
