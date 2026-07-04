import { Hono } from 'hono'
import { cors } from 'hono/cors'
import {
	aiChat,
	aiConfirmAction,
	aiSessionMessages,
	aiSessions,
	aiSetTier,
	aiUsage,
	aiUsageRecent
} from './ai'
import { auth, TRUSTED_ORIGINS } from './auth'
import {
	billingCancel,
	billingCheckout,
	billingOrderInvoice,
	billingState,
	billingSwitch,
	billingSync,
	billingUncancel,
	billingWebhook,
	refreshTierPrices,
	refreshTierProducts
} from './billing'
import { bootstrapSchema } from './bootstrap'
import { contextRoute } from './context'
import {
	createSchema,
	createTodos,
	createValue,
	deleteTodo,
	deleteValue,
	listDataType,
	listSchemas,
	listTodos,
	listValues,
	updateTodos,
	updateValue
} from './data'
import { eventsStream } from './events'
import { deleteFlow, getFlow, listFlows, upsertFlow } from './flows'
import './ontology' // board 0100 — registers the ontology skill's context providers (gismu/predicates) at load
import './config' // board 0110 — registers the skills/actors/runs context providers at load
import { inboxGet, inboxList, mailInbox } from './inbox'
import { deleteType, getType, listTypes, upsertType } from './predicate-types'
import { listRuns, runSkill } from './skills-run'
import { syncPricing } from './usage'
import { deleteSecret, getVault, listSecrets, putSecret, putVault } from './vault'
import { getVibe } from './vibe-registry'

const app = new Hono()

// CORS must be registered BEFORE the routes. Credentials are required so the session
// cookie / bearer token rides cross-origin requests from the app; origin is reflected
// only for trusted origins (a wildcard is illegal together with credentials).
const corsOptions = {
	origin: (origin: string) => (TRUSTED_ORIGINS.includes(origin) ? origin : ''),
	allowHeaders: ['Content-Type', 'Authorization'],
	allowMethods: ['POST', 'GET', 'PATCH', 'DELETE', 'OPTIONS'],
	// `set-auth-token` MUST be exposed so the app (cross-origin) can read the bearer token
	// the bearer plugin returns and persist it — WKWebView drops the cross-site cookie, so
	// this token is how the desktop app stays signed in. board 0050/0052.
	exposeHeaders: ['X-Session-Id', 'set-auth-token'],
	credentials: true
}
app.use('/api/auth/*', cors(corsOptions))
app.use('/api/ai/*', cors(corsOptions))
app.use('/api/admin/*', cors(corsOptions))
app.use('/api/data/*', cors(corsOptions))
// Skill execution (board 0089) — run a skill's flow for the signed-in user (doc-ingest wired first).
app.use('/api/skills/*', cors(corsOptions))
app.use('/api/vibe/*', cors(corsOptions))
// board 0100/0104 — the universal attached-context registry (gismu/predicates/types/data_operations/vibe_*),
// browser-called cross-origin by the Skills config panel + the DB viewer. Needs CORS like every other /api.
app.use('/api/context/*', cors(corsOptions))
// `/api/billing/checkout` is browser-called (needs CORS); `/api/billing/webhook` is a
// server-to-server POST from Polar (no Origin, so CORS is inert there) verified by signature.
app.use('/api/billing/*', cors(corsOptions))
// Realtime: a per-user SSE stream the app fetches to invalidate TanStack Query caches. board 0055.
app.use('/api/events', cors(corsOptions))
// E2EE secrets vault (board 0055). Both the bare path and sub-paths need CORS.
app.use('/api/vault', cors(corsOptions))
app.use('/api/vault/*', cors(corsOptions))
// Admin-only inbound-mail viewer (board 0060). The /webhooks/inbox/mail receiver is server-to-server
// (no CORS); these /api/inbox/* read endpoints are browser-called by the app, so they need CORS.
app.use('/api/inbox/*', cors(corsOptions))

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// TEMPORARY (board 0114 S0 diagnosis) — the WKWebView can't be inspected from the agent, so the vibe
// host beacons its COMPUTED layout here; readings land in the dev log. Dev-only; removed after diagnosis.
app.use('/api/dev/*', cors(corsOptions))
app.post('/api/dev/layout-probe', async (c) => {
	const body = await c.req.json().catch(() => null)
	console.log('[layout-probe]', JSON.stringify(body))
	return c.json({ ok: true })
})

// Authenticated Tinfoil proxy — only signed-in users can run inference. board 0051.
app.post('/api/ai/chat', aiChat)
app.get('/api/ai/usage', aiUsage)
app.get('/api/ai/usage/recent', aiUsageRecent)
app.post('/api/ai/confirm', aiConfirmAction)
app.get('/api/ai/sessions', aiSessions)
app.get('/api/ai/sessions/:id/messages', aiSessionMessages)
app.post('/api/admin/set-tier', aiSetTier)

// Flow/skill CONFIG templates (board 0087, Layer A) — admin-only CRUD; the Skills/Runs UI reads
// flows from here instead of a static JSON import. Distinct from the user-scoped /api/data/*.
app.get('/api/admin/flows', listFlows)
app.get('/api/admin/flows/:id', getFlow)
app.post('/api/admin/flows', upsertFlow)
app.delete('/api/admin/flows/:id', deleteFlow)

// Vibe registry (board 0095, Layer A) — vibe definitions (view/style/logic) as config-as-data; the app
// LOADS a bundle from here + renders it through the engine instead of importing the TS files.
app.get('/api/vibe/:name', getVibe)
// board 0100 — UNIVERSAL attached-context resolver: any actor node's declared `context: [{provider}]`
// is fetched here, so the config UI transparently shows what's in an actor's context window.
app.get('/api/context/:provider', contextRoute)

// Composite TYPE registry (board 0088, Layer A) — admin-only CRUD over the declarative bundle specs
// the generic predication engine runs. Distinct from the user-scoped /api/data/*.
app.get('/api/admin/types', listTypes)
app.get('/api/admin/types/:type', getType)
app.post('/api/admin/types', upsertType)
app.delete('/api/admin/types/:type', deleteType)

// Generic schema-driven user data (board 0053): schemas + schema-validated values.
app.post('/api/data/schemas', createSchema)
app.get('/api/data/schemas', listSchemas)
app.post('/api/data/schemas/:schemaId/values', createValue)
app.get('/api/data/schemas/:schemaId/values', listValues)
app.patch('/api/data/values/:id', updateValue)
app.delete('/api/data/values/:id', deleteValue)

// Todos (board 0087/0088): stored as x1–x5 predications, surfaced via these routes which delegate
// to the generic ontology engine (the `todos` registered type) — the same path the LLM tool uses.
// Skill runner (board 0089): POST a file → run the skill's flow → artifact + document predications
// + provenance + a persisted run trace. The generic runner the LLM `run_skill` tool also calls.
app.get('/api/skills/runs', listRuns)
app.post('/api/skills/:id/run', runSkill)

app.get('/api/data/todos', listTodos)
app.get('/api/data/type/:type', listDataType)
app.post('/api/data/todos', createTodos)
app.patch('/api/data/todos', updateTodos)
app.delete('/api/data/todos/:id', deleteTodo)

// Billing: create a Polar checkout (session-gated) + receive Polar webhooks → sync tier +
// on-demand reconcile (pull customer state from Polar → tier) for the post-checkout return. board 0052.
app.post('/api/billing/checkout', billingCheckout)
app.post('/api/billing/webhook', billingWebhook)
app.post('/api/billing/sync', billingSync)
// Self-service plan management, all in our own UI: read subscriptions+orders, cancel/downgrade
// (period-end or immediate), and resume a scheduled cancellation. board 0052.
app.get('/api/events', eventsStream)
app.get('/api/billing/state', billingState)
app.post('/api/billing/cancel', billingCancel)
app.post('/api/billing/uncancel', billingUncancel)
app.post('/api/billing/switch', billingSwitch)
app.get('/api/billing/orders/:id/invoice', billingOrderInvoice)

// E2EE secrets vault (board 0055): session + tier (>= avenFOUNDER, admin-bypass) gated;
// server-blind. The passkey-PRF-derived key never reaches the server.
app.get('/api/vault', getVault)
app.post('/api/vault', putVault)
app.get('/api/vault/secrets', listSecrets)
app.post('/api/vault/secrets', putSecret)
app.delete('/api/vault/secrets/:id', deleteSecret)

// Incoming webhooks (server-to-server, NO CORS). Postmark INBOUND email → parsed + stored in
// `inbound_email`. Authenticated by a shared secret (Basic auth / ?token= / X-Inbox-Token) since
// Postmark inbound has no signature; fail-closed without POSTMARK_INBOUND_SECRET. board 0060.
app.post('/webhooks/inbox/mail', mailInbox)

// Admin-only inbound-mail viewer: list (headline fields) + one message's full detail. board 0060.
app.get('/api/inbox/messages', inboxList)
app.get('/api/inbox/messages/:id', inboxGet)

// Apple App Site Association (AASA) — lets the native macOS/iOS app use passkeys (WebAuthn PRF)
// with rp.id = this host (api.next.aven.ceo). Served at the well-known path over HTTPS, no
// `.json` suffix, application/json. The app entitlement must list `webcredentials:<this host>`.
// board 0055.
const APPLE_APP_ID = '2P6VCHVJWB.ceo.aven.os' // <Team ID>.<bundle id>
app.get('/.well-known/apple-app-site-association', (c) =>
	c.json({ webcredentials: { apps: [APPLE_APP_ID] } })
)

app.get('/', (c) => c.text('avenOS betterauth server'))

// Polar checkout success landing. The tier is applied by the webhook, so this is just a
// confirmation the user lands on after paying (Polar's success_url target). board 0052.
app.get('/billing/success', (c) =>
	c.html(
		'<!doctype html><meta charset="utf-8"><title>Payment complete</title>' +
			'<body style="font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b1220;color:#f5f1e6">' +
			'<div style="text-align:center;max-width:28rem;padding:2rem">' +
			'<h1 style="font-weight:500">Welcome to avenCITY 🎉</h1>' +
			'<p style="opacity:.7;line-height:1.6">Your subscription is active. You can close this tab and return to avenOS — your plan and weekly MINDS are already syncing.</p>' +
			'</div></body>'
	)
)

// Self-bootstrap the schema before serving any request, so a fresh Neon DB works with
// no manual migrate step. Awaited at module load — Bun finishes evaluating this module
// (top-level await) before it starts the server below. board 0050.
await bootstrapSchema()

// Best-effort: refresh per-model pricing from Tinfoil on boot (recordUsage also
// lazily syncs if a model is unseen). Never blocks startup.
void syncPricing().catch((e) => console.error('[betterauth] pricing sync failed:', e))

// Best-effort on boot: first DISCOVER each tier's product id by metadata.tier (so a config-seeded
// org needs no per-org product-id env vars — board 0062), THEN warm the live price cache from those
// products, so the first credit check / billing state read already has real ids + prices
// (billingState also refreshes lazily). board 0052.
void refreshTierProducts()
	.then(() => refreshTierPrices())
	.catch((e) => console.error('[betterauth] tier product/price warm failed:', e))

const port = Number(new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:8787').port || 8787)

// idleTimeout: Bun closes any connection idle for this many seconds. The default (10s) kills the
// long-lived SSE stream (GET /api/events) and any AI response that pauses >10s, which churned the
// WKWebView connection pool and surfaced as "Load failed" across the app. 120s comfortably covers
// the 15s SSE keep-alive and model think-pauses. board 0055.
export default { port, idleTimeout: 120, fetch: app.fetch }
