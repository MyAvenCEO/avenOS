---
title: Creem subscriptions + in-app billing portal
summary: avenME (42 €) and avenCEO (326 €) become real recurring Creem products auto-seeded from the pricing SSOT, and the Tauri app gets a fully native, brand-styled billing page — current plan, upgrade/downgrade, cancel/resume, invoices — every action proxied through id.next.aven.ceo and strictly scoped to the signed-in customer.
owner: claude
created: 2026-08-21
updated: 2026-08-21
tags: [billing, aven-api, app, creem]
goal: "`bun run --cwd services/aven-api check`, `bun run check` (app) and `bunx biome check services/aven-api app` exit 0; `vitest run tests/billing-subscriptions.test.ts tests/copy.test.ts tests/designer.test.ts` passes proving: seeding upserts two recurring net-priced Creem products from PLANS by metadata.tier, subscription webhooks grant+persist (customer id, subscription id, tier, status) idempotently, /api/billing/me and every /api/billing/* action resolve the customer from the session only (cross-user test returns null/403), and upgrade/cancel/resume/invoices endpoints proxy Creem without exposing the API key; the app's Abrechnung settings pane renders plan, price, renewal, invoice list and action buttons from designer fixtures (screenshot in the card)."
---

# Creem subscriptions + in-app billing portal

## Context

The id service sells exactly one thing today: the one-off avenID name for
25 € (`CREEM_PRODUCT_ID`, single product, `createCheckout` + webhook grant in
`services/aven-api/src/lib/server/billing/`). The website advertises avenME
(42 €/m) and avenCEO (326 €/m), the funnel already carries `tier` through
`name_holds.tier` — but nothing recurring exists in Creem, our DB records no
customer/subscription, and the Tauri app has **zero billing code** (verified:
no billing/subscription/Polar references anywhere in `app/` or on `next`;
Polar exists only on the stale `dev` branch). Creem is the only provider.

Structural gaps found in discovery:

1. **No Creem customer id is persisted anywhere** — `names` has
   `checkout_id`/`order_id` only. Every portal feature is keyed by customer
   id, so capture starts here.
2. **The provider interface is checkout-only** — `PaymentProvider` has
   `createCheckout` + `verifyWebhook`; all `/v1/subscriptions/*` lifecycle
   endpoints are unused.
3. **The `x-api-key` must never reach a client.** All Creem calls stay in
   aven-api; the app talks to our API with the session bearer token only
   (the `auth_names`/SecTask pattern from the account pane extends to this).

Decisions taken with Samuel (2026-08-21):

- **Goal behind the work: billing runs itself.** Routine cases — subscribe,
  upgrade, cancel, invoice — need zero manual work in the Creem dashboard.
- **Fully native portal.** No hosted Creem portal link; every action is a
  branded in-app surface calling our proxy endpoints.
- **Auto-seed from the SSOT.** Products created via `POST /v1/products` from
  `libs/aven-website/src/lib/pricing/plans.ts`, stamped
  `metadata.tier = avenme|avenceo`, resolved at runtime by that tag (the
  pattern the dev branch proved with Polar). One price source, no ids copied
  between environments.
- **Net pricing.** 4200 / 32600 cents **tax-exclusive**; Creem (merchant of
  record) adds the buyer's VAT, matching the site's "zzgl. USt.". Verify the
  tax-exclusive setting in the sandbox early — if Creem cannot price
  exclusive of tax, STOP and surface it rather than charging 42 € gross.
- **Purely customer-self-service.** Every endpoint acts on the signed-in
  session's own data. No admin utilities, no cross-customer lookups, no
  list-all. Ops keeps using the Creem dashboard directly.

## Goal

A member can subscribe to avenME or avenCEO, and afterwards see and manage
the whole relationship — plan, price, renewal, upgrade, downgrade, cancel,
resume, invoices — inside the Tauri app, without anyone touching the Creem
dashboard for them.

**Completion condition** (identical to frontmatter `goal`):

> `bun run --cwd services/aven-api check`, `bun run check` (app) and
> `bunx biome check services/aven-api app` exit 0; `vitest run
> tests/billing-subscriptions.test.ts tests/copy.test.ts
> tests/designer.test.ts` passes proving: seeding upserts two recurring
> net-priced Creem products from PLANS by metadata.tier, subscription
> webhooks grant+persist (customer id, subscription id, tier, status)
> idempotently, /api/billing/me and every /api/billing/* action resolve the
> customer from the session only (cross-user test returns null/403), and
> upgrade/cancel/resume/invoices endpoints proxy Creem without exposing the
> API key; the app's Abrechnung settings pane renders plan, price, renewal,
> invoice list and action buttons from designer fixtures (screenshot in the
> card).

## Approach

One billing boundary, three phases behind one card. Phases 1–2 are pure
aven-api and fully machine-verifiable; phase 3 is the app UX verified
against designer fixtures plus a sandbox smoke.

### Phase 1 — subscriptions exist (aven-api)

**Data.** Migration `0008_subscriptions.sql`:

- `billing_customers (user_id PK → user, creem_customer_id UNIQUE, created_at)`
- `subscriptions (id PK, user_id → user, creem_subscription_id UNIQUE, tier,
  status, current_period_end, cancel_at_period_end bool, price_eur_cents,
  created_at, updated_at)` + index on `user_id`.

Status is Creem's vocabulary verbatim (`active | trialing | paused |
past_due | canceled | expired | scheduled_cancel`) — no invented enum.

**Seeding/discovery.** `billing/products.ts`: `GET /v1/products/search` by
`metadata.tier`; create missing tiers from `PLANS` (price in cents net,
`billing_type: recurring`, monthly, tax-exclusive), cache the map
in-process; `bun run db:seed:billing` script for explicit runs. aven-api
imports `plans.ts` via a workspace dep on `@avenos/aven-website` (plans.ts
is pure TS — keep it that way) + Dockerfile COPY like aven-skills.

**Checkout.** `createSubscriptionCheckout(tier, user)` with the user's email
and `metadata.userId`; `POST /api/billing/subscribe { tier }` (requireUser)
returns the checkout URL.

**Webhooks.** Extend the Creem webhook: on subscription lifecycle events
(exact names confirmed against docs.creem.io/learn/webhooks during build —
known risk), upsert `billing_customers` + `subscriptions` idempotently
(keyed on `creem_subscription_id` + event id, like the existing dedupe).
Only verified-signature payloads are trusted.

### Phase 2 — self-service actions (aven-api proxies)

All `requireUser`; the customer/subscription is always resolved
session → `billing_customers`/`subscriptions` row — **no endpoint accepts a
user, customer, or subscription id from the client** (the row lookup is
ours; a client-supplied id would be the confused-deputy hole).

- `GET  /api/billing/me` — tier, status, period end, price, cancel-pending.
- `POST /api/billing/upgrade { tier }` — `/v1/subscriptions/{id}/upgrade`
  with `proration-charge-immediately` for up, and for down: Creem's
  update/upgrade semantics decide (confirm during build whether downgrade
  is the same endpoint with a cheaper product; UI copy says the change
  applies accordingly).
- `POST /api/billing/cancel` — schedule at period end (default; German
  Kündigungsbutton semantics), body flag for immediate.
- `POST /api/billing/resume` — undo a scheduled cancel / resume paused.
- `GET  /api/billing/invoices` — the customer's transactions
  (`/v1/transactions?customer_id=…`), mapped to date, amount, status,
  and Creem's hosted invoice/receipt URL per row. We link the PDF; we do
  not render invoices ourselves.

Webhook remains the only writer of subscription state — actions return
Creem's response but the DB row updates when the event arrives (UI shows
optimistic pending state).

### Phase 3 — the portal UX (Tauri app + id funnel touches)

New settings category **Abrechnung** directly under Konto in
`app/src/routes/dashboard/settings/` (pattern of `Account.svelte`), talking
to aven-api through new Tauri commands (`billing_me`, `billing_upgrade`,
`billing_cancel`, `billing_resume`, `billing_invoices`) that attach the
session bearer — same shape as `auth_names`.

Pane, brand-styled like Konto (porcelain cards, eyebrow labels):

1. **Aktueller Plan** — tier name, net price + "zzgl. USt.", status chip,
   renewal date ("Verlängert sich am …" / "Endet am …" when cancel is
   scheduled).
2. **Plan wählen / Plan ändern — the in-app pricing UI.** The avenME and
   avenCEO tiers rendered as brand pricing cards side by side (name, role
   line, net price + "zzgl. USt.", the headline features from `PLANS` —
   the same SSOT the website renders), with the current tier marked
   "Dein Plan". With no subscription both carry "Jetzt abonnieren" →
   checkout in the system browser, pane polls `/me` and flips when the
   webhook lands. With one active, the other card becomes "Upgrade" /
   "Wechseln" with the price delta; the confirm dialog states the
   proration ("Differenz wird sofort berechnet" up; down per Creem's
   semantics) and the pane shows a pending state until the webhook.
   avenCOOP does not appear here at all — it is not a Creem product and
   never will be; that relationship is handled individually, outside this
   system. The in-app ladder is avenME and avenCEO only.
3. **Kündigen / Fortsetzen** — one obvious button (Kündigungsbutton law:
   as easy to cancel as to subscribe), default period-end, confirm dialog
   states the end date; a scheduled cancel shows "Fortsetzen".
4. **Rechnungen** — list (date, amount, status) with "PDF" linking Creem's
   receipt URL via the system browser.
5. Every action has busy/error states; failures render the server's message
   in the pane, never a dead end.

Funnel touches: purchase success page and id dashboard show the subscribed
tier; designer runtime gets `billing.me()` + `billing.invoices()` fixtures
(subscription / no-subscription / cancel-scheduled scenarios) so all states
are stylable and screenshotable without a paid account.

### Out of scope — deliberately

avenCOOP entirely — not a Creem product, not seeded, not rendered in the
pane; handled individually outside this system. Also: trials, discounts/coupons,
seat counts, any admin or reporting surface, payment-method management UI
(Creem's checkout owns the card; revisit only if members ask), refunds
(stays a Creem-dashboard act), migrating the existing 25 € avenID flow.

## Steps

1. Migration 0008 + journal; local migrate green.
2. Product seeder + tier map; tests: create-when-missing, upsert-not-dup,
   net-cents payload. **Verify tax-exclusive in sandbox — hard stop if not.**
3. Subscribe checkout + endpoint; webhook upserts + replay-idempotency test.
4. `/api/billing/me` + isolation test (user A cross-reads user B → null).
5. Action proxies (upgrade/cancel/resume/invoices) + tests incl. 403/self-
   scope; grep-proof no client-supplied ids.
   **Checkpoint: API complete and provable before any UI.**
6. Tauri commands + Abrechnung pane against designer fixtures; screenshot
   each state (none/active/cancel-scheduled) into the card.
7. Funnel touches + copy/designer suites green.
8. Sandbox smoke end-to-end: seed products in the test org, subscribe with a
   sandbox card from inside the app flow, watch the webhook land, see the
   pane flip to active, cancel, see "Endet am …". Paste the log.

## Files to touch

- `services/aven-api/migrations/0008_subscriptions.sql` (+ journal)
- `services/aven-api/src/lib/server/billing/{provider,creem,fake,products}.ts`
- `services/aven-api/src/routes/api/billing/{subscribe,me,upgrade,cancel,resume,invoices}/+server.ts`
- `services/aven-api/src/routes/api/webhooks/creem/+server.ts`
- `services/aven-api/src/lib/app-runtime/{contract,runtime.production,runtime.designer}.ts`
- `services/aven-api/src/routes/purchase/success/+page.svelte`, `dashboard/+page.svelte`
- `services/aven-api/package.json`, `Dockerfile`
- `services/aven-api/tests/billing-subscriptions.test.ts` (new)
- `app/src-tauri/src/auth.rs` (billing commands), `app/src-tauri/src/lib.rs`
- `app/src/routes/dashboard/settings/{+page.svelte,Billing.svelte}` (new)

## Acceptance criteria

- [ ] `vitest run tests/billing-subscriptions.test.ts` exits 0: seed
      idempotency, net-cents payload, webhook grant + replay, /me isolation,
      action proxies self-scoped (no client ids), invoices mapped.
- [ ] `bun run --cwd services/aven-api check` and `bun run check` (app) exit 0.
- [ ] `bunx biome check services/aven-api app` exits 0.
- [ ] `tests/copy.test.ts` + `tests/designer.test.ts` green.
- [ ] `grep -rn "requireUser" services/aven-api/src/routes/api/billing/`
      shows every handler; no handler reads a user/customer/subscription id
      from the request.
- [ ] Screenshots of the Abrechnung pane (no-sub with pricing cards,
      active with upgrade card, cancel-scheduled) in the Progress log.
- [ ] Sandbox smoke pasted: subscribe → webhook → active pane → cancel →
      "Endet am …".

## Verification

```sh
bun run --cwd services/aven-api check
bun run check
bunx biome check services/aven-api app
cd services/aven-api && bunx vitest run tests/billing-subscriptions.test.ts tests/copy.test.ts tests/designer.test.ts
grep -rn "requireUser" services/aven-api/src/routes/api/billing/
```

## Progress log

- 2026-08-21 (build, phases 1–2) — Migration 0008 (billing_customers +
  subscriptions), pricing SSOT split into plans-data.ts and exported as
  `@avenos/aven-website/pricing` (plans.ts had a `$lib` import — the spec's
  "no Svelte imports" assumption was false; ctaHref/ctaLabel stay behind in
  plans.ts). CreemProvider gained ensureSubscriptionProducts / subscription
  checkout / change / cancel / resume / listInvoices behind one authed api()
  helper; fake provider mirrors it. SubscriptionService with session-scoped
  me/subscribe/change/cancel/resume/invoices + idempotent applyEvent; six
  /api/billing/* routes (requireUser only); webhook routes subscription.*
  events and no longer misroutes tier checkouts into the name grant.
  `tests/billing-subscriptions.test.ts` 4/4 green against a local PG 15
  (seed net-cents + idempotency, webhook replay, /me isolation, action
  proxying with the caller's own provider id). svelte-check 0/1474.

- 2026-08-21 (later still) — Samuel: avenCOOP is not a Creem product at
  all and is handled individually — removed from the pane entirely; the
  in-app ladder is avenME/avenCEO only.
- 2026-08-21 (later) — Sharpened on Samuel's follow-up: the upgrade view
  is a full in-app pricing UI — tier cards from the PLANS SSOT with the
  current plan marked, upgrade/switch with price delta and proration
  dialog, avenCOOP shown apply-only. Not just a button.
- 2026-08-21 — Discovered with Samuel: real goal = billing runs itself
  (zero manual Creem-dashboard work for routine cases). Decisions: fully
  native portal (no hosted-portal link), auto-seed products from plans.ts
  by metadata.tier, net pricing zzgl. USt. (tax-exclusive — verify in
  sandbox, hard stop if unsupported), strictly customer-self-service with
  no admin utils and no client-supplied ids. One global card covering
  subscriptions wiring + action proxies + Tauri Abrechnung pane; phased
  with a hard checkpoint after the API phase. Creem surface mapped from
  creem.io/SKILL.md (checkouts, /v1/subscriptions/{id}/{upgrade,cancel,
  pause,resume}, /v1/transactions, x-api-key auth, cents pricing).
