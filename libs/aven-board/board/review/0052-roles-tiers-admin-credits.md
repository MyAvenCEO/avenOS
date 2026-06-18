---
title: Roles, product tiers (Polar) & admin for the betterauth API
summary: App-layer authorization on the Hono/Better Auth server — admin role (see all users), Polar-driven product tiers (e.g. avenCITY €7/wk), per-tier AI credit budgets, and where Postgres RLS fits.
owner: claude
created: 2026-06-16
updated: 2026-06-16
tags: [auth, authz, billing, admin]
goal: "Slice 1 done: Better Auth admin plugin wired; `role` column on user (migrated); admin granted SOLELY by flipping `role` in the Neon DB (no hardcoded admin, no in-app granting); the admin-gated list-users endpoint returns 401 unauthenticated (verified) and is admin-only; a READ-ONLY frontend admin panel lists all users + their role, shown only to admins. lib tsc + app svelte-check + biome clean. Tiers (manual) + credit budgets (hard-cap) are follow-on slices."
---

# Roles, tiers, admin & credits

## Context

The betterauth server (board [[0050-betterauth-mainnet-google-gate]] + the AI track
[[0051-mainnet-ai-proxy-usage-persistence]]) currently authenticates users and isolates
each user's data by `session.user.id`. There is **no authorization tier** yet: every
signed-in user can use every feature equally, there's no admin, no paid tier, no credit
budget. This card designs that.

## The architecture (recommended)

**1. Authorization lives in the Hono APP layer — not Postgres roles.**
All DB access goes through the Hono server over a single trusted service connection
(`NEON_PG_KEY`); the client never talks to Postgres directly. So feature-gating belongs
in the API (middleware that reads the user's role/tier), backed by fields stored on the
user. **Postgres roles / RLS are a different tool** (see §4).

**2. Roles + admin — Better Auth `admin` plugin.**
Add the `admin` plugin: it puts a `role` field on the user (`user` | `admin`), and gives
server APIs `listUsers`, `setRole`, ban, impersonate, plus `userHasPermission`. This is
exactly "admin can see all users in the frontend":
- Bootstrap the first admin by flipping a row in Neon: `UPDATE "user" SET role='admin'
  WHERE email='…'` (the "set in the Neon PG backend" step).
- After that, admins promote/demote others via the API (`setRole`) — that's **give/remove
  roles**.
- An admin-gated `GET /api/admin/users` powers a frontend admin view; non-admins get 403.

**3. Product tiers — driven by Polar (already wired).**
We already link each user to a Polar customer (`createCustomerOnSignUp`). A tier like
**avenCITY (€7/week)** is a Polar product/subscription:
- A Polar **webhook** (subscription created/updated/canceled) syncs the user's active
  product → a `tier` field (or an `entitlement` table) in our DB. Polar is the billing
  source of truth; our DB caches the current entitlement for fast gating.
- Admins can manually override a tier (comp/testing) via the admin role tooling.
- The Hono middleware gates tier-only features (`requireTier('avenCITY')`).

**4. AI credit budgets — computed against `ai_usage`.**
Each tier grants a periodic allowance (e.g. avenCITY = **€3 of AI credit per week**). We
already record `cost_usd` per completion in `ai_usage`. So:
- `remaining = allowance(tier) − sum(cost_usd this period)` (reuse the week window from
  `getUsageStats`).
- The proxy checks `remaining > 0` **before** calling Tinfoil; if exhausted → `402`
  (and the UI surfaces "out of credits / upgrade"). Allowance per tier in a small config
  or `tier_pricing` table.

**5. Postgres RLS — defense-in-depth, deferred until direct DB exposure.**
RLS (`auth.uid()` policies) only adds protection when **clients query Postgres
directly** — e.g. the Neon Data API / PostgREST. Today every read/write goes through the
Hono server with a service connection and app-layer `WHERE user_id = session.user.id`
isolation already enforced, so RLS would be **inert** (the service role bypasses it).
Recommendation: **do not add RLS now**; add it as part of a future "expose Neon Data API
to the client" card, where it becomes the real enforcement boundary.

## How Hono + Neon work together cleanly (the answer)

- **Identity & sessions:** Better Auth (Hono) — cookie/bearer → `session.user`.
- **Authorization:** Hono middleware reading `user.role` / `user.tier` (Better Auth admin
  plugin + Polar-synced entitlement). One service DB connection.
- **Billing source of truth:** Polar (subscriptions) → webhook → cached entitlement in Neon.
- **Postgres roles/RLS:** only when/if the client hits Postgres directly (Data API). Not
  needed for the server-mediated API.

One sentence: **roles/tiers are application data the Hono layer enforces; Neon PG
roles/RLS are for direct-DB access you don't have yet.**

## Slices (build agile — slice 1 first)

1. **Roles + admin foundation** *(this card's measurable goal)* — add the `admin` plugin,
   `role` on user, `GET /api/admin/users` (admin-gated, 403 non-admin), bootstrap one
   admin, minimal frontend admin list. Give/remove role via `setRole`.
2. **Tiers via Polar** — webhook → `tier`/entitlement table; `requireTier` middleware;
   surface tier in the UI. (follow-on card)
3. **AI credit budgets** — per-tier weekly allowance enforced in the proxy (402 when out);
   show remaining credits in the usage card. (follow-on card)

## Decisions (confirmed)

- Tier source of truth = **manual roles for now** (assign by hand via admin tooling); wire
  **Polar** billing later (slice 2).
- Credits = **hard cap** (block at 402 when the weekly allowance is spent) — slice 3.
- Admin bootstrap = **manual Neon `UPDATE`** for the first admin, then API-managed. ✓
- Authorization in the **app layer** (Better Auth admin + tier middleware), RLS deferred. ✓

## Acceptance criteria (slice 1)

- [x] `admin` plugin added; `role`/`banned`/… columns on user (Better Auth migrate); first
      admin (`samuel@andert.me`) bootstrapped via Neon `UPDATE`.
- [x] Admin-gated user management via the plugin's `/api/auth/admin/*` routes — **401**
      unauthenticated (verified `GET …/admin/list-users` → 401); admin-only by the plugin.
- [x] **No hardcoded admin** — `admin()` has no `adminUserIds`; admin = the `role` column,
      flipped SOLELY in the Neon DB (Tables UI / SQL editor). No in-app role granting.
- [x] Frontend admin panel (`AdminPanel.svelte`) is **read-only**: lists all users + their
      role badge for admins only; the Admin entry shows only when `session.user.role === 'admin'`.
- [x] `bun --cwd libs/betterauth run check` = 0; app `svelte-check` = 0; biome clean; migrate applied.

## Hand-off

```
/aven-build 0052
```

## Progress log

- `2026-06-16` — Slice 1 BUILT (roles + admin): Better Auth `admin` plugin (server) +
  `adminClient` (app); Better Auth migrate added `role`/`banned`/`banReason`/`banExpires`
  on user + `impersonatedBy` on session; bootstrapped `samuel@andert.me` → admin in Neon;
  `AdminPanel.svelte` lists users + grant/revoke via `setRole`, shown only to admins.
  Verified: `…/admin/list-users` → 401 unauthenticated; lib tsc + svelte-check + biome
  clean. Decisions: manual tiers for now, hard-cap credits, app-layer authz, RLS deferred.
  Moved discover → review. Slices 2 (Polar tiers) + 3 (credit budgets) remain.
- `2026-06-16` — Discovery drafted: app-layer authz, tiers from Polar, credits from
  `ai_usage`, RLS deferred to a future Data-API card. Slice 1 = roles + admin.
