# Stack observer

This tool provides quick, observation-only access to the deployed identity
Compose stack. It reports service state, lists service names, checks the public
health endpoints, and reads bounded logs for one or more services.

It does not expose `exec`, `restart`, `up`, `down`, or arbitrary remote commands.

## Security model

The current implementation uses the existing deployment SSH identity because
that account can inspect the Compose stack under `/opt/aven-api`. The local CLI
only constructs fixed read operations, but the deployment credential itself is
still privileged: the remote account has passwordless `sudo` and Docker access.

Do not use the database-tunnel identity. That account is intentionally restricted
to PostgreSQL port forwarding and cannot run SSH sessions.

For production, prefer a separate observation key backed by a root-owned forced
command that permits only the operations exposed here. Do not grant a nominally
read-only account membership in the `docker` group; access to the Docker socket is
effectively root access.

Logs can contain customer data or operational identifiers. Review them before
copying them into issues, chat, or other systems.

## Requirements

- Bash
- OpenSSH client
- `curl` for `health`
- An existing deployment SSH key, loaded into `ssh-agent` when encrypted
- A pinned `known_hosts` file for the exact deployment hostname

## Configure a profile

Profiles are local and ignored by Git. Create one for `next`:

```sh
cp tools/stack-observe/.env.example tools/stack-observe/.env.next
chmod 600 tools/stack-observe/.env.next
```

Set absolute paths and the public origin:

```dotenv
SSH_HOST=id.next.aven.ceo
SSH_PORT=22
SSH_USER=aven-deploy
SSH_IDENTITY_FILE=/home/operator/.ssh/aven/deploy_ssh_key
SSH_KNOWN_HOSTS_FILE=/home/operator/.ssh/aven/id_next_known_hosts

PUBLIC_BASE_URL=https://id.next.aven.ceo
```

Never put a private key, key passphrase, deployment secret, or service credential
in the profile.

## Commands

Show all containers, including exited one-shot services:

```sh
./tools/stack-observe/observe.sh next status
```

`next` and `status` are the defaults, so this is equivalent:

```sh
./tools/stack-observe/observe.sh
```

List the service names accepted by `logs`:

```sh
./tools/stack-observe/observe.sh next services
```

Check the externally reachable readiness and detailed health endpoints:

```sh
./tools/stack-observe/observe.sh next health
```

Read logs. The default window is one hour and the default limit is 200 lines per
service:

```sh
./tools/stack-observe/observe.sh next logs app
./tools/stack-observe/observe.sh next logs app email-worker --since 30m --tail 500
./tools/stack-observe/observe.sh next logs app --follow
```

With no service name, `logs` reads the bounded logs for the complete stack:

```sh
./tools/stack-observe/observe.sh next logs
```

Accepted `--since` values are positive Go-style durations using `ms`, `s`, `m`,
or `h`. `--tail` must be between 1 and 10000.

### Log retention

Every Compose service uses Docker's `local` logging driver. By default, each
container retains five compressed files of up to 10 MiB each. The oldest file is
deleted when the limit is exceeded. Configure the policy through the deployment
environment:

```dotenv
DOCKER_LOG_MAX_SIZE=10m
DOCKER_LOG_MAX_FILE=5
DOCKER_LOG_COMPRESS=true
```

For `next`, set the same names as GitHub environment variables. Missing or empty
values use the defaults above on the next deployment.

These logs survive container restarts, but not container replacement or removal.
They are intentionally bounded operational history, not an audit archive. Use a
remote logging system with its own time-based retention policy if logs must
survive deployments or host loss.

### Email-worker events

At the default `LOG_LEVEL=info`, the email worker reports:

- startup and the redacted SMTP endpoint;
- SMTP connection verification;
- expired-lease recovery;
- claimed batches and delivery attempts;
- successful deliveries; and
- retry scheduling with the sanitized error, attempt count, and next retry time.

Permanent failures, exhausted retries, and lost queue leases are logged at
`error`; recoverable SMTP and verification failures are logged at `warn`. Idle
polls and successful heartbeats remain quiet. Recipient addresses, SMTP
credentials, encrypted payloads, and message bodies are never included.

For example:

```sh
./tools/stack-observe/observe.sh next logs email-worker --since 1h --tail 200
```

## Production

Production must use a separate profile, deployment identity, known-hosts file,
and public origin:

```sh
cp tools/stack-observe/.env.example tools/stack-observe/.env.production
chmod 600 tools/stack-observe/.env.production
./tools/stack-observe/observe.sh production status
```

Never copy `next` credentials into the production profile.

## Troubleshooting

`missing .env.<profile>`

- Copy `.env.example` to the requested profile name.
- Keep the profile at mode `0600` or `0400`.

`Permission denied (publickey)`

- Confirm the profile uses the deployment account and matching key, not the
  database-tunnel account.
- Load an encrypted deployment key into `ssh-agent`.
- Confirm the account is present in the server's global `AllowUsers` directive.

`unknown service`

- Run `services` to inspect the deployed Compose service names.
- Use Compose service names, not generated container names.

`health` fails while containers are running

- Run `status`, then inspect `app` and `caddy` logs.
- Confirm `PUBLIC_BASE_URL` is the public HTTPS origin without a path.
