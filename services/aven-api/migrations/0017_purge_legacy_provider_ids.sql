-- Card 0162 follow-up: rows written in the Creem era carry Creem-shaped ids
-- in the provider-neutral columns; Polar rejects them (422) the moment they
-- reach the API ("The payment provider rejected list-orders"). Creem never
-- shipped, so these are sandbox test rows — purge everything that is not a
-- Polar UUID and let the session-email lookup re-resolve real customers.
DELETE FROM subscriptions
 WHERE provider_subscription_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
DELETE FROM billing_customers
 WHERE provider_customer_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
