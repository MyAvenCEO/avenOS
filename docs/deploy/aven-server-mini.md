# Deploy runbook — aven-server mini

The **mini** aven is a headless, **stateless** TLS sync relay: one container, no
volume, in-memory engine. It authenticates the *server* with a TLS cert and each
*client* with a did:key challenge bound to the TLS session (see
[`AvenServerPlan.md`](../AvenServerPlan.md) §2 and board item
`libs/aven-board/board/test/0004-aven-server-mini.md`).

> This is the **human** step. It needs a fly.io org and secrets, and it pushes a
> service to the public internet — so it is documented here, not run by CI by
> default. The image build, the transport, and the security handshake are all
> covered by the automated gates (`cargo test`, `docker build`).

## 0. Prerequisites

- [`flyctl`](https://fly.io/docs/flyctl/install/) installed and `fly auth login`.
- Docker (for the local image check) — optional.

## 1. Build the image locally (optional sanity check)

```bash
# from the repo root — the build context MUST be the repo root
docker build -f libs/aven-server/Dockerfile -t aven-server-mini:local .
docker run --rm -p 8080:8080 -p 4290:4290 aven-server-mini:local &
curl -fsS http://127.0.0.1:8080/healthz   # → ok
```

With no `AVEN_SERVER_TLS_CERT/KEY` set, the server generates a self-signed cert
and logs its DER fingerprint — pin that on the device (`ServerTrust::Pinned`).

## 2. Create the fly app (no deploy yet)

```bash
cd libs/aven-server
fly launch --no-deploy --copy-config --name aven-server-mini --region iad
```

`fly.toml` already declares the two services (raw-TCP `4290` for sync, HTTP
`8080` for the healthcheck) and — deliberately — **no `[mounts]`**.

## 3. Set secrets (identity + TLS)

```bash
# Stable server identity (32-byte hex). Keep this safe — it IS the aven's DID.
fly secrets set AVEN_SERVER_SEED="$(openssl rand -hex 32)"

# TLS cert + key. Either bring a real cert for mini.testnet.aven.ceo …
fly secrets set \
  AVEN_SERVER_TLS_CERT="$(cat fullchain.pem)" \
  AVEN_SERVER_TLS_KEY="$(cat privkey.pem)"
# … or omit both to let the server self-sign (then pin its cert DER on devices).
```

> The cert/key are read from the paths in `AVEN_SERVER_TLS_CERT/KEY`. To mount
> secrets as files, use a fly secret file or an entrypoint that writes them; the
> simplest path for mini is a real cert via your own ACME flow, or self-signed +
> client pinning.

## 4. Deploy

```bash
fly deploy
fly logs        # look for "authenticated TLS sync transport listening"
fly status
```

## 5. Point a device at it

Set on the device app:

```
AVENOS_SERVER_SYNC=1
AVENOS_SERVER_ADDR=mini.testnet.aven.ceo:4290
AVENOS_SERVER_CERT_PIN=<hex DER of the server cert>   # if self-signed
```

The app's `try_server_transport` dials the aven, completes the TLS + did:key
handshake, and registers it as a sync peer.

## Notes

- **Stateless:** nothing survives a restart/redeploy. This is the live relay, not
  the durable blind mirror (that is the full `aven-server`, plan §4.0/§4.4).
- **Scaling:** more machines = more relays; the frontier model already supports N
  avens per spark (plan §6).
