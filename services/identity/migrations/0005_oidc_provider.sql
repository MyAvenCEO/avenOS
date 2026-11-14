-- Better Auth oidc-provider storage. Relying parties are registered only through
-- OIDC_CLIENTS, so oauth_application exists for the plugin's fallback lookup but the
-- runtime role cannot write it; client_id columns therefore carry no foreign key. Configured
-- clients skip consent and the consent endpoint is closed, so oauth_consent is read-only too.
CREATE TABLE oauth_application (
  id text PRIMARY KEY, name text NOT NULL, icon text, metadata text,
  client_id text NOT NULL UNIQUE, client_secret text, redirect_urls text NOT NULL, type text NOT NULL,
  disabled boolean NOT NULL DEFAULT false, user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE oauth_access_token (
  id text PRIMARY KEY, access_token text NOT NULL UNIQUE, refresh_token text NOT NULL UNIQUE,
  access_token_expires_at timestamptz NOT NULL, refresh_token_expires_at timestamptz NOT NULL,
  client_id text NOT NULL, user_id text REFERENCES "user"(id) ON DELETE CASCADE, scopes text NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX oauth_access_token_user_id_idx ON oauth_access_token(user_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_expires_idx ON oauth_access_token(access_token_expires_at);
--> statement-breakpoint
CREATE TABLE oauth_consent (
  id text PRIMARY KEY, client_id text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scopes text NOT NULL, consent_given boolean NOT NULL,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX oauth_consent_client_user_idx ON oauth_consent(client_id, user_id);
--> statement-breakpoint
REVOKE ALL ON oauth_application, oauth_consent FROM aven_identity_auth;
--> statement-breakpoint
GRANT SELECT ON oauth_application, oauth_consent TO aven_identity_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_access_token TO aven_identity_auth;
