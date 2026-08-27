-- The pricing wire keys become kebab-case: avenid → aven-name,
-- avenceo → aven-ceo, avencoop → aven-coop. Two columns store them, and both
-- are plain text with no FK to lean on, so the rename has to be spelled out.
--
-- avenme is deliberately NOT mapped. That tier was consolidated into avenCEO
-- and has no successor; a row still carrying it records what somebody
-- actually bought, and rewriting it would invent a purchase. It stays, and
-- the SSOT's planIdOf resolves it to null so no surface offers it as a plan.
--
-- Idempotent by construction: the new values are not in the old set, so a
-- second run matches nothing.
UPDATE subscriptions SET tier = 'aven-name' WHERE tier = 'avenid';
--> statement-breakpoint
UPDATE subscriptions SET tier = 'aven-ceo' WHERE tier = 'avenceo';
--> statement-breakpoint
UPDATE subscriptions SET tier = 'aven-coop' WHERE tier = 'avencoop';
--> statement-breakpoint
-- name_holds.tier records which CTA the visitor arrived from — origin, not
-- entitlement. It is renamed for the same reason: one vocabulary, so a query
-- across the funnel does not have to know both spellings.
UPDATE name_holds SET tier = 'aven-name' WHERE tier = 'avenid';
--> statement-breakpoint
UPDATE name_holds SET tier = 'aven-ceo' WHERE tier = 'avenceo';
--> statement-breakpoint
UPDATE name_holds SET tier = 'aven-coop' WHERE tier = 'avencoop';
