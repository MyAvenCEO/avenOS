-- Recurring tiers (avenME / avenCEO) sold through Creem. Two truths worth a
-- table each: which Creem customer a user is (the key every portal call
-- hangs on), and which subscription they hold. Status is Creem's vocabulary
-- verbatim — invented enums drift from the provider that owns the state.
CREATE TABLE IF NOT EXISTS billing_customers (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  creem_customer_id text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  creem_subscription_id text NOT NULL UNIQUE,
  tier text NOT NULL,
  status text NOT NULL,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  price_eur_cents integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aven_server') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON billing_customers TO aven_server;
    GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO aven_server;
  END IF;
END $$;
