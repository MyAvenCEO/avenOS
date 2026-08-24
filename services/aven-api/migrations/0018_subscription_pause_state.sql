-- Pause is back (card 0162): Polar CAN pause — the API just guards it
-- (active + no scheduled cancel + no end date). Mirror the scheduled-pause
-- flag so the pane can show "Pausiert ab …" in sync with the provider.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pause_at_period_end boolean NOT NULL DEFAULT false;
