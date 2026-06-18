import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { aiChat, aiSessionMessages, aiSessions, aiUsage } from './ai'
import { auth, TRUSTED_ORIGINS } from './auth'
import { syncPricing } from './usage'

const app = new Hono()

// CORS must be registered BEFORE the routes. Credentials are required so the session
// cookie / bearer token rides cross-origin requests from the app; origin is reflected
// only for trusted origins (a wildcard is illegal together with credentials).
const corsOptions = {
	origin: (origin: string) => (TRUSTED_ORIGINS.includes(origin) ? origin : ''),
	allowHeaders: ['Content-Type', 'Authorization'],
	allowMethods: ['POST', 'GET', 'OPTIONS'],
	// `set-auth-token` MUST be exposed so the app (cross-origin) can read the bearer token
	// the bearer plugin returns and persist it — WKWebView drops the cross-site cookie, so
	// this token is how the desktop app stays signed in. board 0050/0052.
	exposeHeaders: ['X-Session-Id', 'set-auth-token'],
	credentials: true
}
app.use('/api/auth/*', cors(corsOptions))
app.use('/api/ai/*', cors(corsOptions))

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

// Authenticated Tinfoil proxy — only signed-in users can run inference. board 0051.
app.post('/api/ai/chat', aiChat)
app.get('/api/ai/usage', aiUsage)
app.get('/api/ai/sessions', aiSessions)
app.get('/api/ai/sessions/:id/messages', aiSessionMessages)

app.get('/', (c) => c.text('avenOS betterauth server'))

// Best-effort: refresh per-model pricing from Tinfoil on boot (recordUsage also
// lazily syncs if a model is unseen). Never blocks startup.
void syncPricing().catch((e) => console.error('[betterauth] pricing sync failed:', e))

const port = Number(new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:8787').port || 8787)

export default { port, fetch: app.fetch }
