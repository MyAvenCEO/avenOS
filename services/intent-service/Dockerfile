FROM rust:1.93.1-bookworm AS build

WORKDIR /repo
COPY .cargo .cargo
COPY services/artifact-store services/artifact-store
COPY services/intent-service services/intent-service
COPY services/tenant-runtime services/tenant-runtime

WORKDIR /repo/services/intent-service
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/repo/target/rust \
    cargo build --locked --release \
    && cp /repo/target/rust/release/aven-intent-service /tmp/aven-intent-service

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10002 --no-create-home intent-service

COPY --from=build /tmp/aven-intent-service /usr/local/bin/aven-intent-service

USER 10002:10002
EXPOSE 8091 8092
ENV INTENT_SERVICE_HEALTH_PORT=8091
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=30 \
  CMD curl --fail --silent --show-error "http://127.0.0.1:${INTENT_SERVICE_HEALTH_PORT}/health/ready" >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/aven-intent-service"]
CMD ["serve"]
