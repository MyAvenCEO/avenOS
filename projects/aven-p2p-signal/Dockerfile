# Build from AvenOS repo root:
#   docker build -f projects/aven-p2p-signal/Dockerfile .
#
# Deferred until localhost P2p signal (`bun scripts/p2p-signal.ts` / `aven-p2p-signal-dht`) is validated.
#
# Runtime: **`bun`** supervises Rust `aven-p2p-signal-dht` + `blind-relay-server.cjs` (no separate Node runtime).# Mount a writable volume at `/data/p2p-signal` for persisted relay HyperDHT seed/key material.

FROM rust:bookworm AS rust-builder
WORKDIR /build
COPY projects/aven-p2p-signal/Cargo.toml projects/aven-p2p-signal/Cargo.lock ./projects/aven-p2p-signal/
COPY projects/aven-p2p-signal/src ./projects/aven-p2p-signal/src
RUN cargo build --release --manifest-path projects/aven-p2p-signal/Cargo.toml

FROM oven/bun:1-bookworm
WORKDIR /app
COPY infra/p2p-signal-relay/package.json ./infra/p2p-signal-relay/
COPY infra/p2p-signal-relay/blind-relay-server.cjs ./infra/p2p-signal-relay/
RUN cd infra/p2p-signal-relay && bun install

COPY projects/aven-p2p-signal/start-fly.ts ./start-fly.ts
COPY --from=rust-builder /build/projects/aven-p2p-signal/target/release/aven-p2p-signal-dht /usr/local/bin/aven-p2p-signal-dht

ENV AVENOS_P2P_SIGNAL_HOST=0.0.0.0
ENV AVENOS_P2P_SIGNAL_RELAY_HOST=0.0.0.0
ENV AVENOS_P2P_SIGNAL_KEYS_DIR=/data/p2p-signal

VOLUME ["/data/p2p-signal"]

EXPOSE 49737/udp
EXPOSE 49738/udp

CMD ["bun", "/app/start-fly.ts"]
