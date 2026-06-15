import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { auth, TRUSTED_ORIGINS } from './auth'

const app = new Hono()

// CORS must be registered BEFORE the auth routes. Credentials are required so the
// session cookie rides cross-origin requests from the app; origin is reflected only
// for trusted origins (a wildcard is illegal together with credentials).
app.use(
	'/api/auth/*',
	cors({
		origin: (origin) => (TRUSTED_ORIGINS.includes(origin) ? origin : ''),
		allowHeaders: ['Content-Type', 'Authorization'],
		allowMethods: ['POST', 'GET', 'OPTIONS'],
		credentials: true
	})
)

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.get('/', (c) => c.text('avenOS betterauth server'))

const port = Number(new URL(process.env.BETTER_AUTH_URL ?? 'http://localhost:8787').port || 8787)

export default { port, fetch: app.fetch }
