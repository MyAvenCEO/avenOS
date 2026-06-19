# betterauth — Bun + Hono auth/API server for the avenOS mainnet (Alberobello).
#
# Build context is the REPO ROOT (the workspace dep @avenos/aven-vibes is path-linked):
#   docker build -f libs/betterauth/Dockerfile -t api-next-aven-ceo .
#
# Stateless: all state lives in Neon Postgres and the schema self-bootstraps on boot
# (src/bootstrap.ts). Runtime config comes entirely from env (Fly secrets) — see fly.toml.

FROM oven/bun:1
WORKDIR /repo

# Bring in the repo. The root .dockerignore drops app/, docs/, ARCHIVE/, node_modules and
# target — so the heavy app toolchain and Rust build dirs never enter the context.
COPY . .

# Trim the monorepo to just the auth server + its one workspace dep (@avenos/aven-vibes),
# so `bun install` neither requires the excluded workspace members (app/docs/ARCHIVE — bun
# errors on a missing literal workspace) nor pulls the app's heavy deps. Also drop the root
# lifecycle scripts (the `prepare` hook needs a .env we don't ship).
RUN bun --eval "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.workspaces=['libs/betterauth','libs/aven-vibes'];delete p.scripts;fs.writeFileSync('package.json',JSON.stringify(p,null,2))" \
 && bun install --ignore-scripts

ENV NODE_ENV=production
WORKDIR /repo/libs/betterauth
# The server binds 0.0.0.0:8787 (port derived from BETTER_AUTH_URL, default 8787) and runs
# the schema bootstrap before serving. Run from source (Bun runs TS directly) so the
# file-based Kysely migrations under ./migrations resolve relative to src/.
EXPOSE 8787
CMD ["bun", "src/server.ts"]
