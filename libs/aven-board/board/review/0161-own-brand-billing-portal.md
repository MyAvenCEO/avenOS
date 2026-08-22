---
title: The whole customer portal, ours — inline checkout, orders, pause, no Creem window
summary: Kill the hosted Creem portal window entirely. Checkout runs INLINE in the Abrechnung pane (same creem-embed protocol the website already uses), "Meine Bestellungen" lists real orders, the subscription lifecycle gains pause/resume, and the official invoice is the one Creem mails — stated plainly, never a foreign window.
owner: claude
created: 2026-08-22
updated: 2026-08-22
tags: [billing, app, aven-api, creem]
goal: "`bun run --cwd services/aven-api check`, `bun run check` (app) and `bunx biome check services/aven-api app` exit 0; `vitest run tests/billing-subscriptions.test.ts tests/creem.test.ts tests/copy.test.ts tests/designer.test.ts` passes and covers orders mapping, pause/resume proxies, checkout-status polling and self-scope of every new endpoint; `grep -rn \"customers/billing\\|billing_portal\\|customerPortalUrl\" services/aven-api/src app/src app/src-tauri/src` prints nothing; the Abrechnung pane renders inline checkout (iframe state), Meine Bestellungen, a paused subscription and the invoice-by-mail note from browser fixtures (screenshots in the card)."
---

# The whole customer portal, ours

## Context

Card 0160 shipped subscriptions and a native Abrechnung pane, but kept two
foreign surfaces: checkout opened in the system browser, and "official
invoices" opened Creem's hosted customer portal in a separate app window.
Samuel's verdict after live testing: no popups, no Creem portal at all —
every feature reproduced in our own brand, in-pane.

Verified against the Creem SDK (`creem@latest` models) and the raw OpenAPI
before writing this, so the spec rests on facts, not hopes:

- **Inline checkout is proven.** The id service's own checkout page already
  embeds Creem in an iframe and listens for `creem-embed` postMessages
  (`ready`, `completed`) — `services/aven-api/src/routes/purchase/checkout/
  +page.svelte`. The pane can host the identical embed.
- **The full lifecycle exists:** `cancel`, `pause`, `resume`, `upgrade`
  (with `update_behavior` = proration-charge-immediately | proration-charge
  | proration-none), `update-subscription` (items + updateBehavior),
  `search-subscriptions`, `get-subscription`, `get-checkout` (status for
  polling), `list-customer-orders` (a real "Meine Bestellungen").
- **The official invoice PDF is NOT reachable via API — at all.** Zero
  invoice/receipt/pdf/document fields across every SDK model; the raw
  transaction schema has 19 fields and none is a document; `POST
  /v1/customers/billing` returns exactly one field, the general portal
  link. Creem (merchant of record) generates the invoice and delivers it
  by **email** to the buyer. Samuel's decision: **email-based** — the
  portal states that the official invoice is in the member's inbox. No
  self-generated PDF, no portal link.
- `OrderEntity` carries the full breakdown (subTotal, taxAmount,
  discountAmount, amountPaid, currency, status) — enough for an honest
  in-app order detail without pretending to be the invoice.
- Creem's create-product API accepts no `metadata` — products are the
  dashboard-created ones, pinned via `CREEM_PRODUCT_AVENME/AVENCEO` (0160
  follow-up, shipped).

Decisions taken with Samuel (2026-08-22):

- **Zero hosted-portal surface.** Delete `POST /api/billing/portal`, the
  `billing_portal` Tauri command, the dedicated window, and the provider's
  `customerPortalUrl`. A grep for `customers/billing`, `billing_portal`,
  `customerPortalUrl` must come back empty — that is part of the metric.
- **Inline checkout with graceful fallback.** The embed runs inside the
  pane; if Creem refuses the frame from the app origin (website embed
  works, app origin untested), the pane falls back to the dedicated
  in-app window — never the system browser.
- **Invoice = email.** "Die offizielle Rechnung hat dir Creem per E‑Mail
  geschickt" next to each order, with the date. Nothing to download.
- Still strictly customer-self-service: every endpoint resolves the
  customer from the session; no client-supplied ids.

## Goal

A member never leaves the Abrechnung pane for anything billing-related:
subscribing, seeing orders, changing, pausing, resuming, cancelling — and
the only reference to Creem is the sentence telling them where the invoice
went.

**Completion condition** (identical to frontmatter `goal`):

> `bun run --cwd services/aven-api check`, `bun run check` (app) and
> `bunx biome check services/aven-api app` exit 0; `vitest run
> tests/billing-subscriptions.test.ts tests/creem.test.ts
> tests/copy.test.ts tests/designer.test.ts` passes and covers orders
> mapping, pause/resume proxies, checkout-status polling and self-scope of
> every new endpoint; `grep -rn "customers/billing\|billing_portal\|
> customerPortalUrl" services/aven-api/src app/src app/src-tauri/src`
> prints nothing; the Abrechnung pane renders inline checkout (iframe
> state), Meine Bestellungen, a paused subscription and the
> invoice-by-mail note from browser fixtures (screenshots in the card).

## Approach

### aven-api

- **Remove** `portalUrl` (service), `routes/api/billing/portal`, and
  `customerPortalUrl` from `PaymentProvider` + both providers.
- **Orders.** Provider `listOrders(providerCustomerId)` →
  `GET /v1/customers/{id}/orders` (SDK op `listCustomerOrders`), mapped to
  `{ id, createdAt, productName, tier, subTotalCents, taxCents,
  discountCents, amountPaidCents, currency, status }`. Route
  `GET /api/billing/orders` (requireUser; customer resolved by session via
  the existing `customerId()` email fallback).
- **Pause / resume.** Provider `pauseSubscription(id)` →
  `POST /v1/subscriptions/{id}/pause`; `resumeSubscription` already exists
  and also lifts a pause. Service `pause(userId)` on an active row; route
  `POST /api/billing/pause`. Status `paused` already flows through the
  webhook upsert; no migration.
- **Downgrade semantics.** Confirm in the sandbox whether a cheaper
  product goes through `/upgrade` (same endpoint, `update_behavior:
  proration-charge`) or `POST /v1/subscriptions/{id}` (update-subscription
  items). Implement one `change(userId, tier)` that picks: up →
  `proration-charge-immediately`; down → `proration-charge` (applies next
  cycle, no refund maths). Copy in the UI reflects which one happened.
- **Checkout status.** Route `GET /api/billing/checkout/{id}/status` is NOT
  added — the client must never pass ids. Instead `POST
  /api/billing/subscribe` returns `{ checkoutUrl, checkoutId }` and stores
  the id on a short-lived `billing_checkouts (user_id, checkout_id,
  created_at)` row (new migration 0009); `GET /api/billing/checkout`
  (no params) returns the session's latest checkout status via
  `GET /v1/checkouts/{id}` (`status` field) so the pane can poll without
  relying solely on the iframe message.
- Tests in `billing-subscriptions.test.ts`: orders mapping from a stubbed
  list, pause → `/pause` with the caller's own provider id, stranger pause
  → `SUBSCRIPTION_MISSING`, checkout status resolved from the stored row
  (bob sees null). `tests/creem.test.ts` config literal gains nothing new.

### app (Tauri + pane)

- Tauri commands: `billing_orders`, `billing_pause`, `billing_checkout`
  (status); `billing_subscribe` now returns the URL to the pane (for the
  iframe) instead of the command opening anything; `billing_portal`
  **deleted**.
- **CSP** (`app/src-tauri/tauri.conf.json`, both profiles):
  `frame-src` += `https://*.creem.io`. Nothing else — the iframe talks to
  Creem, the pane talks to our API.
- **Inline checkout.** Clicking "Jetzt abonnieren" swaps the pricing cards
  for an in-pane card holding the iframe (`allow="payment *;
  publickey-credentials-get *"`), header "Checkout · avenME", a quiet
  "Abbrechen" back to the cards. The pane listens for `creem-embed`
  messages from `creem.io` origins exactly as the website does: `ready` →
  hide the skeleton; `completed` → show "Zahlung bestätigt — dein Plan
  erscheint gleich" and poll `/me` (+ `/checkout` status) until the
  webhook lands. **Fallback:** if no `ready` arrives within 8 s, or the
  frame errors, open the dedicated in-app window (existing
  WebviewWindow pattern) with the same URL and keep polling.
- **Meine Bestellungen** section: one row per order — date, product,
  Gesamt, status chip — expanding to Netto/USt./Rabatt/Bezahlt and the
  line **"Die offizielle Rechnung hat dir Creem am {date} per E‑Mail
  geschickt."** The former Rechnungen list (transactions) is replaced by
  orders; transactions stay only as the data source for period fields if
  needed.
- **Pausieren / Fortsetzen.** Next to Kündigen: "Pausieren" with a
  confirm ("Abrechnung pausiert, Zugang ruht, jederzeit fortsetzen"); a
  paused plan shows status chip "Pausiert" and a "Fortsetzen" button.
- Fixtures (`?billing=none|active|paused|cancel|checkout`) so every state
  incl. the inline iframe card (with a placeholder src in browser mode)
  and the orders list screenshot without a paid account.
- Remove the portal button, the "Creem-Portal" copy, and every hosted-
  portal reference.

### Out of scope

Self-generated invoice PDFs (decided against), payment-method changes
(Creem's checkout owns the card; no API), refunds (ops act in the Creem
dashboard), discounts, seat counts, avenCOOP, any admin surface.

## Steps

1. Strip the portal: provider method, service, route, Tauri command,
   window, pane button/copy. Grep in the metric goes green first.
2. Migration 0009 `billing_checkouts`; `subscribe` stores + returns
   `checkoutId`; `GET /api/billing/checkout` status route; tests.
3. Orders: provider + service + route + tests.
4. Pause: provider + service + route + tests. Downgrade behaviour decided
   and documented in `change()`.
   **Checkpoint: API complete, suites green.**
5. CSP + Tauri commands (`billing_orders`, `billing_pause`,
   `billing_checkout`; `billing_subscribe` returns URL).
6. Pane: inline checkout card + creem-embed listener + 8 s fallback;
   Meine Bestellungen with the email line; Pausieren/Fortsetzen; fixtures
   for all five states; screenshots into the card.
7. Gates + sandbox smoke: subscribe INLINE in the Mac app with a test
   card, watch `completed` → webhook → AKTIV; pause → Pausiert → resume;
   confirm whether Creem allowed the frame from the app origin (or the
   fallback fired — record which).

## Files to touch

- `services/aven-api/migrations/0009_billing_checkouts.sql` (+ journal)
- `services/aven-api/src/lib/server/billing/{provider,creem,fake,subscriptions}.ts`
- `services/aven-api/src/routes/api/billing/{orders,pause,checkout}/+server.ts`
  (new); `routes/api/billing/portal/` (deleted)
- `services/aven-api/tests/billing-subscriptions.test.ts`
- `app/src-tauri/tauri.conf.json` (CSP), `app/src-tauri/src/auth.rs`,
  `app/src-tauri/src/lib.rs`
- `app/src/routes/dashboard/settings/Billing.svelte`

## Acceptance criteria

- [x] `grep -rn "customers/billing\|billing_portal\|customerPortalUrl"
      services/aven-api/src app/src app/src-tauri/src` prints nothing.
- [x] `vitest run tests/billing-subscriptions.test.ts tests/creem.test.ts
      tests/copy.test.ts tests/designer.test.ts` exits 0, including orders
      mapping, pause proxy (own id), stranger-pause refusal, checkout
      status from the stored row.
- [x] `bun run --cwd services/aven-api check`, `bun run check` (app),
      `bunx biome check services/aven-api app` exit 0.
- [x] No `/api/billing/*` handler reads a user/customer/subscription/
      checkout id from the request (grep on the routes dir).
- [x] Screenshots: inline checkout card, Meine Bestellungen with the
      email line, paused state with Fortsetzen, cancel-scheduled.
- [ ] Sandbox smoke pasted: inline subscribe → `completed` → AKTIV; pause
      → resume; frame allowed or fallback fired (recorded).

## Verification

```sh
grep -rn "customers/billing\|billing_portal\|customerPortalUrl" services/aven-api/src app/src app/src-tauri/src
bun run --cwd services/aven-api check
bun run check
bunx biome check services/aven-api app
cd services/aven-api && bunx vitest run tests/billing-subscriptions.test.ts tests/creem.test.ts tests/copy.test.ts tests/designer.test.ts
grep -rn "requireUser" services/aven-api/src/routes/api/billing/
```

## Progress log

- 2026-08-22 (build → review) — Every hosted-portal surface deleted
  (route, Tauri command, window, provider method); the metric grep prints
  nothing. aven-api: migration 0009 `billing_checkouts`, `subscribe`
  stores the session's checkout, `GET /api/billing/checkout` (no params)
  reports its status via `GET /v1/checkouts?checkout_id=`; orders from
  `GET /v1/customers/{id}/orders`; pause via `POST /v1/subscriptions/{id}/
  pause`. App: CSP frame-src += https://*.creem.io; commands
  billing_orders/pause/checkout + an allow-listed (https, creem.io host)
  billing_checkout_window for the 8-second no-`ready` fallback. Pane:
  inline checkout card with the creem-embed listener, Meine Bestellungen
  with per-order Netto/Rabatt/USt./Bezahlt/Bestell-Nr. and the "Creem hat
  dir die Rechnung per E-Mail geschickt" line, Pausieren/Fortsetzen. All
  five fixture states driven in-browser; checkout, paused and active-with-
  order-detail-and-pause-confirm screenshotted in-session. Gates: api
  0/1484, app 0/525, biome clean, clippy silent, suites 12/12. OPEN for
  review: the sandbox smoke in the Mac app — inline subscribe, and
  recording whether Creem allowed the frame or the fallback fired.

- 2026-08-22 (later) — Samuel pointed at the official monorepo
  (github.com/armitage-labs/creem). Re-verified there: `creem` 1.6.0 is the
  current recommended SDK (packages/creem-sdk, Speakeasy-generated from the
  OpenAPI — the same package inspected above, not deprecated); `creem_io`
  and `@creem_io/webhook-types` were also grepped. Across all three,
  "invoice" occurs only as the transaction `type` enum value and a
  period-field comment — still no document/receipt URL anywhere. The
  email-based decision stands on that.

- 2026-08-22 — Discovered with Samuel after live testing of 0160. Facts
  verified against the Creem SDK + raw OpenAPI: inline embed proven by the
  website's own checkout page; cancel/pause/resume/upgrade/update/orders/
  get-checkout all exist; the official invoice PDF is unreachable via API
  (zero document fields anywhere; billing-link endpoint returns only the
  general portal link). Decisions: zero hosted-portal surface (grep-
  enforced), inline checkout with in-app-window fallback (never the
  system browser), invoice = email ("Creem hat dir die Rechnung per
  E‑Mail geschickt"), still strictly self-service with no client ids.
