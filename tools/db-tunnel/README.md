# Database tunnel

This tool forwards a local TCP port through SSH to PostgreSQL on an Aven host. It supports separate profiles for `next` and `production`.

## Connection path

The deployed Compose stack publishes PostgreSQL only on the server loopback interface:

```text
Local database client
127.0.0.1:55433
        │
        │ SSH local forwarding
        ▼
Remote host 127.0.0.1:55432
        │
        │ Docker port mapping
        ▼
PostgreSQL container :5432
```

The local machine does not join the Docker network. PostgreSQL is not published on the server's public interfaces.

## Security model

Use all of the following:

- One SSH key per person and environment.
- An encrypted private key stored outside the repository.
- One non-sudo Unix tunnel account per person.
- No shell, PTY, agent forwarding, X11 forwarding, remote forwarding, or Unix-socket forwarding.
- Local TCP forwarding only to `127.0.0.1:55432`.
- One read-only PostgreSQL role per person.
- Strict SSH host-key verification.
- A local profile file with mode `0600`.

Never share private keys, tunnel accounts, or PostgreSQL roles. The SSH username, key fingerprint, and PostgreSQL username provide separate audit identities.

## Requirements

Local machine:

- Bash
- OpenSSH client
- `psql` only when using `--psql`
- An existing privileged SSH key for the one-time server bootstrap

Server:

- The deployed identity Compose stack under `/opt/aven-api`
- PostgreSQL published as `127.0.0.1:55432:5432`
- An administrator able to use `sudo`

## 1. Create an operator key

Store it outside the repository:

```sh
install -d -m 700 ~/.ssh/aven
ssh-keygen \
  -t ed25519 \
  -a 64 \
  -f ~/.ssh/aven/id_next_db_tunnel \
  -C 'daniel@id.next.aven.ceo db-tunnel'
chmod 600 ~/.ssh/aven/id_next_db_tunnel
chmod 644 ~/.ssh/aven/id_next_db_tunnel.pub
```

Use a unique passphrase. Do not put the key contents or passphrase in `.env.next`.

Load the key into `ssh-agent` for one hour:

```sh
ssh-add -t 1h ~/.ssh/aven/id_next_db_tunnel
```

## 2. Pin the server host key

Capture the key for the exact hostname used by the profile:

```sh
ssh-keyscan -H -t ed25519 id.next.aven.ceo > ~/.ssh/aven/id_next_known_hosts
chmod 600 ~/.ssh/aven/id_next_known_hosts
ssh-keygen -lf ~/.ssh/aven/id_next_known_hosts
```

`ssh-keyscan` does not authenticate the server. Compare the displayed fingerprint with this command run independently in the Hetzner server console:

```sh
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Continue only when the fingerprints match.

## 3. Create a restricted Unix account

The example account is `aven-db-daniel`. Use a unique account for every operator.

Upload only the public operator key using the existing deployment key:

```sh
scp \
  -i /absolute/path/to/existing-deployment-private-key \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/aven/id_next_known_hosts \
  ~/.ssh/aven/id_next_db_tunnel.pub \
  aven-deploy@id.next.aven.ceo:/tmp/aven-db-daniel.pub
```

Open an administrative session:

```sh
ssh \
  -i /absolute/path/to/existing-deployment-private-key \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/aven/id_next_known_hosts \
  aven-deploy@id.next.aven.ceo
```

Create the group, account, and restricted `authorized_keys` entry:

```sh
sudo groupadd --force aven-db-tunnel
id -u aven-db-daniel >/dev/null 2>&1 || \
  sudo useradd \
    --create-home \
    --gid aven-db-tunnel \
    --shell /usr/sbin/nologin \
    aven-db-daniel
sudo passwd --lock aven-db-daniel

sudo install \
  -d \
  -m 700 \
  -o aven-db-daniel \
  -g aven-db-tunnel \
  /home/aven-db-daniel/.ssh

sudo awk \
  '{ print "restrict,port-forwarding,permitopen=\"127.0.0.1:55432\" " $0 }' \
  /tmp/aven-db-daniel.pub \
  | sudo tee /home/aven-db-daniel/.ssh/authorized_keys >/dev/null

sudo chown aven-db-daniel:aven-db-tunnel \
  /home/aven-db-daniel/.ssh/authorized_keys
sudo chmod 600 /home/aven-db-daniel/.ssh/authorized_keys
rm -f /tmp/aven-db-daniel.pub
```

The public key is not secret. The key options are still required because they limit what a stolen private key can request.

## 4. Restrict the tunnel group in SSH

Keep the current administrative session open while changing SSH configuration.

The hardened Aven host has a global `AllowUsers` directive. Add the tunnel account
to that directive while preserving every account already listed. For example, edit
`/etc/ssh/sshd_config.d/99-aven-hardening.conf` so that it contains:

```text
AllowUsers aven-deploy aven-db-daniel
```

Every additional operator tunnel account must also be appended to this line. A
matching `Match Group` block does not override the global login allowlist; an
omitted account is rejected before its public key is evaluated.

Create `/etc/ssh/sshd_config.d/90-aven-db-tunnel.conf`:

```sh
sudo tee /etc/ssh/sshd_config.d/90-aven-db-tunnel.conf >/dev/null <<'EOF'
Match Group aven-db-tunnel
    AuthenticationMethods publickey
    PubkeyAuthentication yes
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    AllowTcpForwarding local
    AllowStreamLocalForwarding no
    PermitOpen 127.0.0.1:55432
    AllowAgentForwarding no
    X11Forwarding no
    PermitTTY no
    PermitTunnel no
    PermitUserRC no
    MaxSessions 0
EOF
```

`MaxSessions 0` disables shell, login, and subsystem sessions while retaining forwarding. Validate before reloading:

```sh
sudo sshd -t
sudo systemctl reload ssh
```

Inspect the effective policy:

```sh
sudo sshd -T \
  -C user=aven-db-daniel,host=id.next.aven.ceo,addr=127.0.0.1 \
  | grep -E 'allowusers|allowtcpforwarding|allowstreamlocalforwarding|permitopen|permittty|maxsessions'
```

Expected values include:

```text
allowusers aven-deploy aven-db-daniel
allowtcpforwarding local
allowstreamlocalforwarding no
permitopen 127.0.0.1:55432
permittty no
maxsessions 0
```

## 5. Create a read-only PostgreSQL role

Do not use `postgres`, `aven_provisioner`, `aven_migrator`, or an application runtime role for routine access.

From the administrative SSH session:

```sh
cd /opt/aven-api
sudo docker compose \
  --env-file .env \
  -f docker-compose.yml \
  -f docker-compose.deploy.yml \
  exec db psql -U postgres -d aven
```

Create a role unique to the operator:

```sql
CREATE ROLE aven_operator_daniel
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  CONNECTION LIMIT 10;

ALTER ROLE aven_operator_daniel SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE aven TO aven_operator_daniel;
GRANT USAGE ON SCHEMA public TO aven_operator_daniel;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO aven_operator_daniel;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO aven_operator_daniel;

ALTER DEFAULT PRIVILEGES FOR ROLE aven_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO aven_operator_daniel;
ALTER DEFAULT PRIVILEGES FOR ROLE aven_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO aven_operator_daniel;

\password aven_operator_daniel
```

The final command prompts for the password without putting it in shell history.

Customer databases require separate `CONNECT`, schema, table, sequence, and default-privilege grants. The tunnel exposes the cluster endpoint but does not bypass PostgreSQL authorization.

## 6. Configure the local profile

The repository tracks only `.env.example`. `.env.next` and `.env.production` are ignored.

```sh
cp tools/db-tunnel/.env.example tools/db-tunnel/.env.next
chmod 600 tools/db-tunnel/.env.next
```

Set:

```dotenv
SSH_HOST=id.next.aven.ceo
SSH_PORT=22
SSH_USER=aven-db-daniel
SSH_IDENTITY_FILE=/home/daniel/.ssh/aven/id_next_db_tunnel
SSH_KNOWN_HOSTS_FILE=/home/daniel/.ssh/aven/id_next_known_hosts

LOCAL_DB_PORT=55433
REMOTE_DB_HOST=127.0.0.1
REMOTE_DB_PORT=55432

PGDATABASE=aven
PGUSER=aven_operator_daniel
PGPASSWORD=the-operator-database-password
```

The file may contain the PostgreSQL password, but never the private key or its passphrase. Keep it at mode `0600`.

## 7. Connect

Keep a foreground tunnel open for DataGrip, DBeaver, TablePlus, or another local client:

```sh
./tools/db-tunnel/connect.sh next
```

Client settings:

```text
Host:     127.0.0.1
Port:     55433
Database: aven
User:     aven_operator_daniel
Password: value from .env.next
SSL:      disabled for this local connection
```

The PostgreSQL connection is inside the encrypted SSH channel. Do not enable the database client's own SSH tunnel at the same time.

Open `psql` and close the tunnel automatically when it exits:

```sh
./tools/db-tunnel/connect.sh next --psql
```

Select another permitted database:

```sh
./tools/db-tunnel/connect.sh next --psql cust_example
```

## 8. Verify restrictions

The tunnel must work:

```sh
./tools/db-tunnel/connect.sh next --psql
```

An interactive shell must fail:

```sh
ssh \
  -i ~/.ssh/aven/id_next_db_tunnel \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/aven/id_next_known_hosts \
  aven-db-daniel@id.next.aven.ceo
```

A forward to any other destination must fail. Start this forbidden forward in one terminal:

```sh
ssh \
  -N \
  -i ~/.ssh/aven/id_next_db_tunnel \
  -L 127.0.0.1:55434:127.0.0.1:3000 \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/aven/id_next_known_hosts \
  aven-db-daniel@id.next.aven.ceo
```

Then connect to its local listener from another terminal:

```sh
nc -vz 127.0.0.1 55434
```

The SSH terminal must report `administratively prohibited`. Stop it with `Ctrl-C`.

The database role must reject writes:

```sql
CREATE TABLE tunnel_write_test(id integer);
```

## 9. Audit

SSH authentication records include the account and public-key fingerprint:

```sh
sudo journalctl -u ssh --since today | grep aven-db-daniel
```

On systems using file-based authentication logs:

```sh
sudo grep aven-db-daniel /var/log/auth.log
```

Active PostgreSQL sessions show the individual database role:

```sql
SELECT usename, datname, client_addr, application_name, state
FROM pg_stat_activity
WHERE usename = 'aven_operator_daniel';
```

## 10. Rotate or revoke access

To rotate a key:

1. Generate a new key with a new comment.
2. Add the new restricted public-key line.
3. Test the new key.
4. Remove the old public-key line.

To disable SSH access immediately, move the authorized key out of service:

```sh
sudo mv \
  /home/aven-db-daniel/.ssh/authorized_keys \
  /home/aven-db-daniel/.ssh/authorized_keys.revoked
```

Disable database login and terminate its existing sessions:

```sql
ALTER ROLE aven_operator_daniel NOLOGIN;
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE usename = 'aven_operator_daniel'
  AND pid <> pg_backend_pid();
```

Do not delete an account or role until its ownership and audit requirements have been checked.

## 11. Troubleshooting

`no host key ... in known_hosts`

- Capture the key using the exact `SSH_HOST` value.
- Verify the fingerprint independently.

`Permission denied (publickey)`

- Confirm `SSH_USER` names the operator account.
- Confirm the operator account is present in every applicable global `AllowUsers` directive.
- Confirm the matching public key is in that account's `authorized_keys`.
- Confirm the private key and `.env.next` have mode `0600`.
- Load an encrypted key with `ssh-add`.

`open failed: administratively prohibited`

- Confirm the script targets `127.0.0.1:55432`.
- Check both the key's `permitopen` option and the effective `sshd` policy.

`bind ... Address already in use`

- Stop the other local tunnel or change `LOCAL_DB_PORT`.

PostgreSQL authentication failure

- Confirm the individual database role and password.
- Confirm the role has `CONNECT` to the selected database.
- Do not substitute an application or provisioner password.

## 12. Production profile

Production uses separate accounts, keys, known-hosts files, PostgreSQL roles, and profile values:

```sh
cp tools/db-tunnel/.env.example tools/db-tunnel/.env.production
chmod 600 tools/db-tunnel/.env.production
./tools/db-tunnel/connect.sh production
```

Never copy `next` credentials into production.

The account, `authorized_keys`, and SSH policy created above survive normal application deployments, but not server replacement. Before using this for production, manage the tunnel group and SSH policy through infrastructure code. Keep only reviewed operator public keys in that configuration; private keys and database passwords remain outside the repository.

## References

- [OpenSSH client](https://man.openbsd.org/ssh.1)
- [OpenSSH server configuration](https://man.openbsd.org/sshd_config)
- [OpenSSH authorized keys](https://man.openbsd.org/sshd.8)
- [Docker published ports](https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/)
