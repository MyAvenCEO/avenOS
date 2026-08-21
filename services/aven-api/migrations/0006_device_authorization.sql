CREATE TABLE IF NOT EXISTS device_code (
  id text PRIMARY KEY,
  device_code text NOT NULL,
  user_code text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL,
  status text NOT NULL,
  last_polled_at timestamp with time zone,
  polling_interval integer,
  client_id text,
  scope text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS device_code_device_code_unique ON device_code(device_code);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS device_code_user_code_unique ON device_code(user_code);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS device_code_expires_idx ON device_code(expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS device_code_user_idx ON device_code(user_id);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON device_code TO aven_server;
  END IF;
END $$;
