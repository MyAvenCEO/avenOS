# aven-server mini — headless, stateless TLS sync relay.
#
# Build context is the REPO ROOT (the crates are path-linked: aven-server →
# ../aven-db, ../aven-p2p, with no cargo workspace). Build from the repo root:
#   docker build -f libs/aven-server/Dockerfile -t aven-server-mini .

# ── builder ──────────────────────────────────────────────────────────────────
FROM rust:1.93-bookworm AS builder

# rust-rocksdb (pulled by groove's `client-p2p` feature) builds bundled RocksDB
# C++ → needs clang/libclang + a C/C++ toolchain.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      clang libclang-dev build-essential cmake pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# The toolchain file pins 1.93.1; rustup honours it. `.cargo/config.toml` points
# the target dir at target/rust.
COPY rust-toolchain.toml ./
COPY .cargo ./.cargo
COPY libs ./libs

RUN cargo build --release --manifest-path libs/aven-server/Cargo.toml \
 && cp target/rust/release/aven-server /usr/local/bin/aven-server

# ── runtime ──────────────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends libstdc++6 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home aven

COPY --from=builder /usr/local/bin/aven-server /usr/local/bin/aven-server

USER aven
ENV AVEN_SERVER_BIND=0.0.0.0:4290 \
    AVEN_SERVER_HEALTH_BIND=0.0.0.0:8080
EXPOSE 4290 8080

ENTRYPOINT ["/usr/local/bin/aven-server"]
