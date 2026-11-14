-- Better Auth 1.7: the jwt plugin records each key's algorithm and curve (existing rows keep
-- NULL, which the plugin reads as the configured EdDSA/Ed25519), and verification rows are
-- looked up by identifier.
ALTER TABLE jwks ADD COLUMN alg text, ADD COLUMN crv text;
--> statement-breakpoint
CREATE INDEX verification_identifier_idx ON verification(identifier);
