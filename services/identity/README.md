# Aven Identity (`aven.id`)

This service owns the complete human identity boundary: account provisioning,
passkey registration and authentication, sessions, native device authorization,
and short-lived signed access tokens. No Aven business service may read its
database.

Public verification is deliberately small:

- `GET /api/auth/jwks` publishes rotating Ed25519 verification keys.
- `GET /api/auth/token` exchanges an authenticated identity session for a
  five-minute `aven-services` JWT.
- `GET /.well-known/openid-configuration` advertises those endpoints.

The authenticated `/dashboard` lists the account's credentials and allows the
holder to add additional passkeys. The provisioning endpoint under
`/internal/v1/accounts` is service-authenticated and is the only signup ingress;
it returns a bootstrap link only until the first qualifying passkey exists.
