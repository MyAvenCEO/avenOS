-- Card 0162: the payment provider became Polar. The billing columns named
-- after Creem become provider-neutral so the next swap is code-only. The
-- unique indexes/constraints follow the rename automatically in Postgres,
-- and the upsert's ON CONFLICT targets the column, not the constraint name.
ALTER TABLE billing_customers RENAME COLUMN creem_customer_id TO provider_customer_id;
ALTER TABLE subscriptions RENAME COLUMN creem_subscription_id TO provider_subscription_id;
