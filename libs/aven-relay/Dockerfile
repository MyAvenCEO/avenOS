# Build from AvenOS repo root:
#   docker build -f libs/aven-relay/Dockerfile .
#
# Runtime: Bun supervises Rust HyperDHT bootstrap + co-hosted blind-relay (UDP 49737).
# HTTP :8080 serves `/.well-known/aven-relay.json` for health checks and client embeds.
#
# Mount a writable volume at `/data/p2p-signal` for persisted relay + bootstrap key material.

FROM rust:bookworm AS rust-builder
WORKDIR /build
COPY libs/aven-p2p/Cargo.toml libs/aven-p2p/Cargo.lock ./libs/aven-p2p/
COPY libs/aven-p2p/src ./libs/aven-p2p/src
COPY libs/aven-relay/Cargo.toml libs/aven-relay/Cargo.lock ./libs/aven-relay/
COPY libs/aven-relay/src ./libs/aven-relay/src
RUN cargo build --release --manifest-path libs/aven-relay/Cargo.toml

FROM oven/bun:debian AS runtime
WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

COPY libs/aven-relay/start-fly.ts ./start-fly.ts
COPY --from=rust-builder /build/libs/aven-relay/target/release/aven-relay-dht /usr/local/bin/aven-relay-dht

ENV AVENOS_P2P_SIGNAL_KEYS_DIR=/data/p2p-signal

EXPOSE 8080/tcp
EXPOSE 49737/udp

CMD ["bun", "/app/start-fly.ts"]
