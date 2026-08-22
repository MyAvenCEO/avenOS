-- The session's own checkouts, so "where does my checkout stand" never needs
-- the client to name one. Short-lived by nature; the newest row per user
-- is the one that matters.
CREATE TABLE IF NOT EXISTS billing_checkouts (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  checkout_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS billing_checkouts_user_idx ON billing_checkouts(user_id, created_at DESC);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON billing_checkouts TO aven_server;
    GRANT USAGE, SELECT ON SEQUENCE billing_checkouts_id_seq TO aven_server;
  END IF;
END $$;
