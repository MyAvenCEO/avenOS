-- Better Auth oauth-provider storage. Relying parties are registered only through
-- OIDC_CLIENTS and served by the plugin's client discovery, so oauth_client exists for the
-- plugin's lookup but stays empty and read-only for the runtime role; client_id columns
-- therefore carry no foreign key. Only access tokens are written. Refresh tokens are never
-- issued (no offline_access scope, no refresh grant), configured clients skip consent, no
-- protected resources are configured and clients are public, so those tables are read-only
-- (refresh tokens also deletable, for authorization-code replay cleanup) or not granted.
CREATE TABLE oauth_client (
  id text PRIMARY KEY, client_id text NOT NULL UNIQUE, client_secret text, client_discovery_id text,
  disabled boolean DEFAULT false, skip_consent boolean, enable_end_session boolean, subject_type text,
  scopes text[], client_credentials_scopes text[],
  user_id text REFERENCES "user"(id) ON DELETE CASCADE, created_at timestamptz, updated_at timestamptz,
  name text, uri text, icon text, contacts text[], tos text, policy text,
  software_id text, software_version text, software_statement text,
  redirect_uris text[] NOT NULL, post_logout_redirect_uris text[],
  backchannel_logout_uri text, backchannel_logout_session_required boolean,
  token_endpoint_auth_method text, application_type text, jwks text, jwks_uri text,
  grant_types text[], response_types text[], require_pkce boolean,
  dpop_bound_access_tokens boolean DEFAULT false, reference_id text, metadata jsonb
);
--> statement-breakpoint
CREATE TABLE oauth_resource (
  id text PRIMARY KEY, identifier text NOT NULL UNIQUE, name text NOT NULL,
  access_token_ttl integer, refresh_token_ttl integer, signing_algorithm text, signing_key_id text,
  allowed_scopes text[], custom_claims jsonb, dpop_bound_access_tokens_required boolean DEFAULT false,
  disabled boolean DEFAULT false, created_at timestamptz, updated_at timestamptz,
  policy_version integer DEFAULT 1, metadata jsonb
);
--> statement-breakpoint
CREATE TABLE oauth_client_resource (
  id text PRIMARY KEY, client_id text NOT NULL,
  resource_id text NOT NULL REFERENCES oauth_resource(identifier) ON DELETE CASCADE,
  metadata jsonb, created_at timestamptz, UNIQUE (client_id, resource_id)
);
--> statement-breakpoint
CREATE TABLE oauth_refresh_token (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, client_id text NOT NULL,
  session_id text REFERENCES session(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reference_id text, authorization_code_id text, resources text[], requested_user_info_claims text[],
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, revoked timestamptz,
  rotated_at timestamptz, rotation_replay_response text, rotation_replay_expires_at timestamptz,
  auth_time timestamptz, confirmation jsonb, scopes text[] NOT NULL
);
--> statement-breakpoint
CREATE INDEX oauth_refresh_token_session_id_idx ON oauth_refresh_token(session_id);
--> statement-breakpoint
CREATE INDEX oauth_refresh_token_user_id_idx ON oauth_refresh_token(user_id);
--> statement-breakpoint
CREATE INDEX oauth_refresh_token_code_idx ON oauth_refresh_token(authorization_code_id);
--> statement-breakpoint
-- Access tokens are opaque (no resource audience) and die with their session: the plugin
-- revokes them when Better Auth deletes a session, and the cascade covers direct deletes.
CREATE TABLE oauth_access_token (
  id text PRIMARY KEY, token text NOT NULL UNIQUE, client_id text NOT NULL,
  session_id text REFERENCES session(id) ON DELETE CASCADE,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  reference_id text, authorization_code_id text, resources text[], requested_user_info_claims text[],
  refresh_id text REFERENCES oauth_refresh_token(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, revoked timestamptz,
  confirmation jsonb, scopes text[] NOT NULL
);
--> statement-breakpoint
CREATE INDEX oauth_access_token_session_id_idx ON oauth_access_token(session_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_user_id_idx ON oauth_access_token(user_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_code_idx ON oauth_access_token(authorization_code_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_refresh_id_idx ON oauth_access_token(refresh_id);
--> statement-breakpoint
CREATE INDEX oauth_access_token_expires_idx ON oauth_access_token(expires_at);
--> statement-breakpoint
CREATE TABLE oauth_consent (
  id text PRIMARY KEY, client_id text NOT NULL,
  user_id text REFERENCES "user"(id) ON DELETE CASCADE,
  reference_id text, resources text[], requested_user_info_claims text[], scopes text[] NOT NULL,
  created_at timestamptz, updated_at timestamptz
);
--> statement-breakpoint
CREATE INDEX oauth_consent_client_user_idx ON oauth_consent(client_id, user_id);
--> statement-breakpoint
CREATE TABLE oauth_client_assertion (id text PRIMARY KEY, expires_at timestamptz NOT NULL);
--> statement-breakpoint
REVOKE ALL ON oauth_client, oauth_resource, oauth_client_resource, oauth_refresh_token,
  oauth_access_token, oauth_consent, oauth_client_assertion FROM aven_identity_auth;
--> statement-breakpoint
GRANT SELECT ON oauth_client, oauth_resource, oauth_client_resource, oauth_consent TO aven_identity_auth;
--> statement-breakpoint
GRANT SELECT, DELETE ON oauth_refresh_token TO aven_identity_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_access_token TO aven_identity_auth;
