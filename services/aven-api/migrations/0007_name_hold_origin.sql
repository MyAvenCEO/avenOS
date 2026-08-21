-- Where a hold came from, and what the person told us on the way in.
--
-- The waitlist used to live on the marketing site and POST to a webhook, so
-- none of this reached the database. Now the funnel is one flow on the id
-- service and the hold is the record of it: which tier the CTA came from,
-- how to address them, and — the one we actually read — what they want to
-- build, which is how a wildcard invite gets decided.
ALTER TABLE name_holds ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT '';
ALTER TABLE name_holds ADD COLUMN IF NOT EXISTS salutation text NOT NULL DEFAULT '';
ALTER TABLE name_holds ADD COLUMN IF NOT EXISTS idea text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS name_holds_tier_idx ON name_holds (tier);
