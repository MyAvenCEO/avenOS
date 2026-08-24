FROM oven/bun:1.3.13 AS manifests
WORKDIR /repo
COPY package.json bun.lock ./
COPY app/package.json app/package.json
COPY libs/aven-artifact-store/package.json libs/aven-artifact-store/package.json
COPY libs/aven-board/package.json libs/aven-board/package.json
COPY libs/aven-brand/package.json libs/aven-brand/package.json
COPY libs/aven-skills/package.json libs/aven-skills/package.json
COPY libs/aven-ui/package.json libs/aven-ui/package.json
COPY libs/aven-website/package.json libs/aven-website/package.json
COPY infrastructure/identity/package.json infrastructure/identity/package.json
COPY services/aven-api/package.json services/aven-api/package.json

FROM manifests AS build
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --filter @avenos/aven-api
COPY services/aven-api services/aven-api
COPY libs/aven-artifact-store libs/aven-artifact-store
# The pricing + legal SSOT: aven-api syncs its Polar products from the
# brand's plan data (@avenos/aven-brand/pricing) and the id app's layout
# renders the Impressum from @avenos/aven-brand, so the lib's source must
# exist where the workspace symlink points.
COPY libs/aven-brand libs/aven-brand
RUN bun --cwd services/aven-api build

FROM manifests AS production-dependencies
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --production --filter @avenos/aven-api

FROM oven/bun:1.3.13
WORKDIR /repo/services/aven-api
ENV NODE_ENV=production
COPY --from=production-dependencies /repo/node_modules /repo/node_modules
COPY --from=production-dependencies /repo/services/aven-api/node_modules ./node_modules
COPY --from=build /repo/services/aven-api/build ./build
COPY --from=build /repo/services/aven-api/src ./src
COPY --from=build /repo/services/aven-api/scripts ./scripts
COPY --from=build /repo/services/aven-api/migrations ./migrations
COPY --from=build /repo/services/aven-api/package.json ./package.json
# The built server imports the workspace Artifact Store SDK through Bun's
# node_modules symlink, so the symlink target must exist in the runtime image.
COPY --from=build /repo/libs/aven-artifact-store /repo/libs/aven-artifact-store
# scripts/ (migrate, billing seed) run unbundled and resolve the workspace
# symlink at runtime — the brand source must be present in the image too.
COPY --from=build /repo/libs/aven-brand /repo/libs/aven-brand
EXPOSE 3000
USER bun
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=30 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "build/index.js"]
