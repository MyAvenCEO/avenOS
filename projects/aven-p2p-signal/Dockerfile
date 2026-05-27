# Build from AvenOS repo root:
#   docker build -f projects/aven-p2p-signal/Dockerfile .
#
# Runtime: Bun supervises Rust HyperDHT bootstrap + co-hosted blind-relay (UDP 49737).
# HTTP :8080 serves `/.well-known/aven-relay.json` for health checks and client embeds.
#
# Mount a writable volume at `/data/p2p-signal` for persisted relay + bootstrap key material.

FROM rust:bookworm AS rust-builder
WORKDIR /build
COPY projects/aven-p2p-signal/Cargo.toml projects/aven-p2p-signal/Cargo.lock ./projects/aven-p2p-signal/
COPY third_party/peeroxide-dht ./third_party/peeroxide-dht
COPY projects/aven-p2p-signal/src ./projects/aven-p2p-signal/src
RUN cargo build --release --manifest-path projects/aven-p2p-signal/Cargo.toml

FROM oven/bun:debian AS runtime
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY projects/aven-p2p-signal/start-fly.ts ./start-fly.ts
COPY --from=rust-builder /build/projects/aven-p2p-signal/target/release/aven-p2p-signal-dht /usr/local/bin/aven-p2p-signal-dht

ENV AVENOS_P2P_SIGNAL_KEYS_DIR=/data/p2p-signal

EXPOSE 8080/tcp
EXPOSE 49737/udp

CMD ["bun", "/app/start-fly.ts"]
