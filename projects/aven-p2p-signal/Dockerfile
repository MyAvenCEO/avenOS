# Build from AvenOS repo root:
#   docker build -f projects/aven-p2p-signal/Dockerfile .
#
# Runtime: Bun supervises Rust `aven-p2p-signal-dht` + `blind-relay-server.cjs`.
# HTTP :8080 serves `/.well-known/aven-relay.json` for health checks and diagnostics.
#
# Mount a writable volume at `/data/p2p-signal` for persisted relay HyperDHT seed/key material.

FROM rust:bookworm AS rust-builder
WORKDIR /build
COPY projects/aven-p2p-signal/Cargo.toml projects/aven-p2p-signal/Cargo.lock ./projects/aven-p2p-signal/
COPY projects/aven-p2p-signal/src ./projects/aven-p2p-signal/src
RUN cargo build --release --manifest-path projects/aven-p2p-signal/Cargo.toml

# Bun base: `oven/bun:1-bookworm` was never a published tag → use Debian-based official image (`debian`), glibc-compatible with rust:bookworm binary.
FROM oven/bun:debian AS runtime
# Blind-relay uses HyperDHT native addons (`uv_*`). Bun's bundled `node` shim crashes (`uv_interface_addresses`) — Debian Node runs `.cjs` only.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends nodejs \
	&& rm -rf /var/lib/apt/lists/* \
	&& sh -ec 'test -x /usr/bin/nodejs && ! test -e /usr/bin/node && ln -s /usr/bin/nodejs /usr/bin/node || true'
WORKDIR /app
COPY infra/p2p-signal-relay/package.json ./infra/p2p-signal-relay/
COPY infra/p2p-signal-relay/blind-relay-server.cjs ./infra/p2p-signal-relay/
RUN cd infra/p2p-signal-relay && bun install

COPY projects/aven-p2p-signal/start-fly.ts ./start-fly.ts
COPY --from=rust-builder /build/projects/aven-p2p-signal/target/release/aven-p2p-signal-dht /usr/local/bin/aven-p2p-signal-dht

ENV AVENOS_P2P_SIGNAL_KEYS_DIR=/data/p2p-signal

EXPOSE 8080/tcp
EXPOSE 49737/udp
EXPOSE 49738/udp

CMD ["bun", "/app/start-fly.ts"]
