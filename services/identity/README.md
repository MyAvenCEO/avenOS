# Aven Identity (`aven.id`)

This service owns the complete human identity boundary: account provisioning,
passkey registration and authentication, sessions, native device authorization,
and short-lived signed access tokens. No Aven business service may read its
database.

Public verification is deliberately small:

- `GET /api/auth/jwks` publishes rotating Ed25519 verification keys.
- `GET /api/auth/token` exchanges an authenticated identity session for a
  five-minute `aven-services` JWT.
- `GET /.well-known/openid-configuration` advertises those endpoints and the OpenID
  Connect login below (`token_endpoint` is the OIDC one; the service-token exchange is
  `aven_service_token_endpoint`).

The authenticated `/dashboard` lists the account's credentials and allows the
holder to add and rename passkeys. Registration suggests `aven.id-<email>-<device>-<browser>`;
the holder edits that suggestion before the phone/password-manager creation prompt.
Once the holder edits or clears the field, late-arriving account details do not
replace that input with the suggestion.
The chosen value is sent in both WebAuthn `user.name` and `user.displayName` before
`navigator.credentials.create`, without changing the opaque user handle, RP ID,
challenge, verification requirements, or exclusions. The password manager owns its
presentation and may shorten or otherwise format that label.
**Rename** afterward changes only the account's displayed list label.
Names are trimmed, limited to 128 characters, and cannot contain control characters.
The existing identity plugin owns registration and ownership-checked renaming; changing
the label does not change credential material or rename the password-manager entry.
Device/browser names are coarse suggestions, not hardware identification.

## OpenID Connect sign-in for other web apps

A separate web app (for example a self-hosted coordinator UI) can sign people in with the
standard authorization-code flow with PKCE, using Better Auth's `@better-auth/oauth-provider`
plugin:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/auth/oauth2/authorize` | Authorization request; returns `code` + `state` to the registered redirect URI |
| `POST /api/auth/oauth2/token` | Form-encoded code exchange (public client, `code_verifier`); returns `id_token` and a short access token |
| `GET /api/auth/oauth2/userinfo` | Claims for that access token (`Authorization: Bearer`) |
| `GET /api/auth/jwks` | The same Ed25519 keys that sign service JWTs |

Relying parties exist only in configuration. Every other plugin endpoint returns 404:
dynamic registration, client, consent and resource management (including
`/api/auth/admin/oauth2/*`), introspection, revocation, RP logout, the continue/consent
steps and the plugin's own discovery documents. Register a client with `OIDC_CLIENTS`, a
JSON array:

```sh
OIDC_CLIENTS='[{"client_id":"coordinator","name":"Coordinator","redirect_uris":["https://coordinator.example.com/auth/callback"]}]'
```

The plugin looks clients up through its client-discovery extension, which reads them from
this variable; the `oauth_client` table stays empty and the runtime database role can only
read it. Clients are public (no secret; Basic auth, `client_secret` and client assertions
are refused) and must send `code_challenge_method=S256`; `plain` and missing PKCE are
refused. Redirect URIs match
exactly, must be canonical HTTPS URLs without credentials or fragments (HTTP only for
`localhost`/`127.0.0.1` outside production) and are also the only origins allowed to call
token, userinfo, JWKS and discovery from a browser (CORS, no credentials). There is no
consent screen for configured clients. Requests must carry `state`; scopes are `openid`
plus optionally `profile` and `email`. There are no refresh tokens: `offline_access` and
the refresh grant are refused. The plugin receives only the standard code-flow parameters;
`claims`, `resource`, `request`/`request_uri`, DPoP and the other extensions it supports
are dropped or refused by the gate.

Only a real passkey session gets a code: the same rule as the service JWT `amr`
(no `setup_token_hash`, and the account holds a passkey). Without a session, or for
`prompt=login` / an exceeded `max_age`, the browser goes to `/login?returnTo=…` and comes
back to the same authorization request after the passkey ceremony; `returnTo` only
accepts the same-origin authorize path. A setup-link session or passkey-less account is
sent to `/dashboard` (or receives `login_required` for `prompt=none`).

The ID token is EdDSA-signed with `iss` = `PUBLIC_BASE_URL`, `aud` = `client_id`,
`sub` = the stable account id (the service JWT `sub`), `amr: ["passkey"]`, `auth_time`
(the passkey sign-in), the request `nonce`, `at_hash`, `email`/`email_verified` with the
`email` scope, and `name` with `profile`. The plugin reserves `amr`, so identity re-signs
the ID token it issued with the same key to add it. The ID token and the opaque access
token live `ACCESS_TOKEN_TTL_SECONDS` (five minutes by default). Codes live two minutes
and are single use: a wrong `code_verifier` does not consume the code, a replayed code is
refused and revokes the tokens it issued. Signing out revokes the access tokens issued
for that session.

The plugin can resume a pending authorization from a signed `oauth_query` request field
after any response that sets a session cookie, including setup-link sign-in. The gate
never lets the plugin produce one (it handles sign-in, `prompt` and `max_age` itself),
and Better Auth's first `before` hook refuses every request that carries the field, so
the policy gate in `src/lib/server/oidc.ts` is the only path to a code.

The provisioning endpoint under
`/internal/v1/accounts` is service-authenticated and is the only signup ingress;
it returns a bootstrap link only until the first qualifying passkey exists.

## Pending enrollment

Setup links contain a random token whose verification record stores only a hash, expire after seven days,
and remain usable across browsers until enrollment. Opening a link creates a
30-minute setup-only session and redirects to a clean URL. That session cannot obtain
an ordinary service JWT. Issuing a replacement invalidates the previous link and its
pending sessions. First-passkey insertion, link removal and all setup-session revocation
share one database transaction and account lock. A second browser cannot win the same
first-enrollment race. Established passkey sessions can register additional credentials.

The setup-session migration revokes existing sessions because their historical
provenance cannot be established. It does not delete accounts or passkeys.

A pending dashboard can request a replacement email, at most once per minute per
account. The existing service-authenticated provisioning action also accepts `resend:
true` for support; it returns an email-queued result, not the replacement token. Issuing
the new link, revoking old setup sessions and queuing its email are one transaction.
The replacement ends the current setup session; the user continues from the new email.

Opening a setup link and registering the first passkey queue security notices. Link-use
notices coalesce per account/hour. Neither notice includes a setup token. A durable
identity outbox retries delivery to the checkout environment that provisioned the
account; checkout uses its existing encrypted email queue and SMTP worker. Relay
credentials are purpose-derived from each environment's provisioning secret, never
interchangeable with that secret or another environment's credential. Identity receives
no SMTP key. `IDENTITY_MAIL_ORIGINS` must follow `IDENTITY_PROVISIONING_SECRETS` order;
the deployment renders both. Keep each origin paired with its environment's secret.
Changing an origin also requires migrating persisted account delivery channels.

Replacement delivery temporarily retains an AES-GCM-encrypted token in the identity
outbox, using a purpose-derived key from `BETTER_AUTH_SECRET`; the authentication record
still contains only its hash. Relay acknowledgement clears that encrypted copy. The
checkout queue encrypts its delivery payload independently. Superseded/expired tokens
are not retried, delivered metadata is removed after seven days, and failed records
after thirty days. Drain replacement messages before rotating the identity secret.
Old accounts without a delivery channel need the authenticated support resend action
to associate their provisioning environment; do not invent a recipient or channel.

Proof-of-work issuance is stateless: purpose-bound, expiring challenges are signed with
a daily derived HMAC key. Only verified redemptions write a short-lived, unique replay
marker. Current and immediately previous key generations are accepted within challenge
lifetime. Indexed cleanup drains bounded batches without making issuance wait for SQL.
The worker logs aggregate proof counts and cleanup backlog, never challenge tokens.
