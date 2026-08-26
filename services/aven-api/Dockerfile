FROM oven/bun:1.3.13 AS manifests
WORKDIR /repo
COPY package.json bun.lock .npmrc ./
COPY app/package.json app/package.json
COPY libs/aven-artifact-store/package.json libs/aven-artifact-store/package.json
COPY libs/aven-board/package.json libs/aven-board/package.json
COPY libs/aven-hosting/package.json libs/aven-hosting/package.json
COPY libs/aven-ui/package.json libs/aven-ui/package.json
COPY infrastructure/identity/package.json infrastructure/identity/package.json
COPY services/aven-api/package.json services/aven-api/package.json
COPY services/static-site-host/package.json services/static-site-host/package.json

# @myavenceo/aven-ceo lives in GitHub Packages, which needs a token even to read.
# Done once HERE because both installing stages derive `FROM manifests`, so they
# inherit it rather than each repeating the step. Passed as a BuildKit secret so
# the credential never lands in a layer, and appended to the .npmrc copied above
# (which pins the registry but deliberately carries no token). Build with:
#   docker build --secret id=npm_token,env=NODE_AUTH_TOKEN .
RUN --mount=type=secret,id=npm_token,required=true \
  printf '//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/npm_token)" >> "$HOME/.npmrc"

FROM manifests AS build
RUN --mount=type=cache,target=/root/.bun/install/cache,sharing=locked \
  bun install --frozen-lockfile --filter @avenos/aven-api
COPY services/aven-api services/aven-api
COPY libs/aven-artifact-store libs/aven-artifact-store
# The pricing + legal SSOT: aven-api syncs its Polar products from the brand's
# plan data (@myavenceo/aven-ceo/pricing) and the id app's layout renders the
# Impressum from @myavenceo/aven-ceo. That package is now a PUBLISHED
# dependency resolved into node_modules by the install above, not a workspace
# source directory, so there is nothing to COPY for it — the .npmrc below tells
# bun which registry to fetch it from.
COPY libs/aven-hosting libs/aven-hosting
RUN bun --cwd services/aven-api build
# The four entrypoints compose and operations run inside this image. They are
# bundled for the same reason the server is: a bundle carries its imports, so
# nothing has to resolve a workspace symlink at runtime and no lib source needs
# to be dragged into the runtime stage. That is the rule the brand already
# follows from the other side — shared ACROSS repos becomes a published package,
# shared WITHIN the repo gets bundled here. Nothing resolves source at runtime.
RUN cd services/aven-api && bun build \
  scripts/migrate.ts \
  scripts/email-worker.ts \
  scripts/environment-worker.ts \
  scripts/environment.ts \
  --target=bun --outdir=build/scripts

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
COPY --from=build /repo/services/aven-api/migrations ./migrations
COPY --from=build /repo/services/aven-api/package.json ./package.json
# The brand SSOT is no longer a workspace directory to copy: @myavenceo/aven-ceo
# arrives through node_modules above, which the production-dependencies stage
# already installs (root node_modules carries bun's store, the service's carries
# the link into it). scripts/ resolve it from there like any other dependency.
EXPOSE 3000
USER bun
HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=30 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "build/index.js"]
