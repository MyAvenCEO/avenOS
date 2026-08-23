FROM rust:1.93.1-bookworm AS build

WORKDIR /repo
COPY .cargo .cargo
COPY services/artifact-store services/artifact-store

WORKDIR /repo/services/artifact-store
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/repo/target/rust \
    cargo build --locked --release -p aven-artifact-store-server --bin aven-artifact-store \
        -p aven-artifact-processor --bin aven-artifact-processor \
    && cp /repo/target/rust/release/aven-artifact-store /tmp/aven-artifact-store \
    && cp /repo/target/rust/release/aven-artifact-processor /tmp/aven-artifact-processor

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --no-create-home artifact-store

COPY --from=build /tmp/aven-artifact-store /usr/local/bin/aven-artifact-store
COPY --from=build /tmp/aven-artifact-processor /usr/local/bin/aven-artifact-processor

USER 10001:10001
EXPOSE 8087 8088 8089
ENV ARTIFACT_STORE_HEALTH_PORT=8087
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=30 \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${ARTIFACT_STORE_HEALTH_PORT}/health/ready" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/aven-artifact-store"]
CMD ["serve"]
