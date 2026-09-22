FROM rust:1.93.1-bookworm AS mail-parser
WORKDIR /repo
COPY libs/aven-mail/parser ./parser
RUN cargo build --locked --release --manifest-path parser/Cargo.toml

FROM oven/bun:1.4.2 AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
  --mount=type=secret,id=npm_token,required=true \
  printf '@myavenceo:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/npm_token)" > "$HOME/.npmrc" \
  && bun install --frozen-lockfile --filter '!./' --filter @avenos/actor-runner-service \
  && rm -f "$HOME/.npmrc"
RUN bun --cwd services/actor-runner build
RUN mkdir -p /runtime-node-modules/@napi-rs \
  && cp -RL node_modules/.bun/@napi-rs+canvas@*/node_modules/@napi-rs/canvas /runtime-node-modules/@napi-rs/canvas \
  && cp -RL node_modules/.bun/@napi-rs+canvas-linux-x64-gnu@*/node_modules/@napi-rs/canvas-linux-x64-gnu /runtime-node-modules/@napi-rs/canvas-linux-x64-gnu

RUN mkdir -p /runtime-node-modules/pdfjs-dist \
  && cp libs/aven-document-ingest/node_modules/pdfjs-dist/package.json /runtime-node-modules/pdfjs-dist/ \
  && cp -RL libs/aven-document-ingest/node_modules/pdfjs-dist/standard_fonts /runtime-node-modules/pdfjs-dist/

FROM oven/bun:1.4.2
ARG OS_SECURITY_REFRESH=local
RUN test -n "$OS_SECURITY_REFRESH" && apt-get update && apt-get upgrade --yes --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /repo/services/actor-runner/build ./build
COPY --from=build /runtime-node-modules ./node_modules
COPY --from=mail-parser /repo/parser/target/release/aven-mail-parser /app/bin/aven-mail-parser
ENV MAIL_PARSER_BINARY=/app/bin/aven-mail-parser
ENV NODE_ENV=production
ENV BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS=5
EXPOSE 3010
USER bun
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=20 \
  CMD bun -e "fetch('http://127.0.0.1:3010/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "build/index.js"]
