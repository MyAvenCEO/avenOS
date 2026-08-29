# Fully local passkey development

This stack runs identity, checkout, the facade, both central databases, the
customer provisioner, Intent Service, Actor Runner, the workers, and Mailpit on
the developer machine. It does not call `aven.id`,
`api.aven.ceo`, Polar, SMTP, or a deployed server. WebAuthn uses the browser's
secure-context exception for the exact `http://localhost` origin and RP ID.

```sh
bun run local:up
bun run local:account -- you@example.test
```

Open the printed setup URL in the browser and create a passkey. Then run the
Rust desktop application:

```sh
bun run local:app -- linux
# or on macOS
bun run local:app -- mac
```

The development desktop binary is intentionally not entitled for a native
platform passkey domain. It starts the same device authorization flow used by
unsupported desktop platforms, opens the local identity dashboard in the
system browser, and waits. Authenticate there with the `localhost` passkey and
approve the displayed device code. The Rust process receives a revocable
identity session; each product call exchanges it for a short-lived
`aven-services` JWT before calling the local facade. `local:account` also creates
a local entitlement and customer environment. The client automatically selects
it once the provisioner reports both customer components ready; no deployed
database, token, or host is involved.

Stop and erase only this disposable local stack with:

```sh
bun run local:down
```

Run `bun run test:e2e:platform` for the non-interactive equivalent. That test
creates two virtual passkeys on distinct authenticators and exercises the
device flow and service-token exchange automatically.
