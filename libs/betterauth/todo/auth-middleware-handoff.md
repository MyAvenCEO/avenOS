# Task: Centralize Better Auth session checks in Hono middleware

## Goal

Move authentication and admin authorization out of individual AI/admin handlers and into Hono middleware registered in `libs/betterauth/src/server.ts`.

The desired result is a single route-level security boundary:

- all `/api/ai/*` routes require a valid Better Auth session
- all `/api/admin/*` routes require a valid Better Auth session and `admin` role
- `/api/auth/*` remains public and continues to be handled directly by Better Auth

## Why this matters

`libs/betterauth/src/ai.ts` currently repeats the same session lookup and `401` response in every protected handler:

```ts
const session = await auth.api.getSession({ headers: c.req.raw.headers })
if (!session) return c.json({ error: 'unauthorized' }, 401)
```

That duplicated check appears in:

- `aiChat`
- `aiUsage`
- `aiSessions`
- `aiSessionMessages`
- `aiSetTier`

`aiSetTier` also performs an inline admin-role check. This makes auth a per-handler responsibility, which is easy to forget when adding new routes. Route middleware makes the security invariant visible and auditable in one place.

## Relevant files

- `libs/betterauth/src/server.ts`
  - Owns Hono app creation, CORS, route registration, and should own route auth boundaries.
- `libs/betterauth/src/auth.ts`
  - Owns the Better Auth instance and should export shared auth/session types.
- `libs/betterauth/src/ai.ts`
  - Contains protected AI/chat/usage/admin handlers that should become business-logic-only handlers.

## Current state

`server.ts` registers protected routes directly:

```ts
app.post('/api/ai/chat', aiChat)
app.get('/api/ai/usage', aiUsage)
app.get('/api/ai/sessions', aiSessions)
app.get('/api/ai/sessions/:id/messages', aiSessionMessages)
app.post('/api/admin/set-tier', aiSetTier)
```

Each handler then independently calls `auth.api.getSession(...)`.

## Target design

### 1. Export shared auth context types from `auth.ts`

Add a reusable Hono environment type based on the Better Auth session shape:

```ts
export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

export type AuthEnv = {
	Variables: {
		session: Session
	}
}
```

Keep this in `auth.ts`, not `server.ts`, so handlers do not import route wiring.

### 2. Type the Hono app with `AuthEnv`

In `server.ts`:

```ts
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { auth, TRUSTED_ORIGINS, type AuthEnv } from './auth'

const app = new Hono<AuthEnv>()
```

### 3. Add `requireSession` middleware in `server.ts`

Keep this middleware local to `server.ts` for now. Do not create a new abstraction/file unless more middleware appears later.

```ts
const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	c.set('session', session)
	await next()
})
```

### 4. Add `requireAdmin` middleware in `server.ts`

```ts
const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
	const session = c.get('session')
	if ((session.user as { role?: string }).role !== 'admin') {
		return c.json({ error: 'forbidden' }, 403)
	}
	await next()
})
```

`requireAdmin` should assume `requireSession` already ran. Register them together for admin routes.

### 5. Apply middleware by route group

Preserve CORS registration before routes/middleware that could return responses.

Recommended `server.ts` order:

```ts
app.use('/api/auth/*', cors(corsOptions))
app.use('/api/ai/*', cors(corsOptions))
app.use('/api/admin/*', cors(corsOptions))

app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.use('/api/ai/*', requireSession)
app.use('/api/admin/*', requireSession, requireAdmin)

app.post('/api/ai/chat', aiChat)
app.get('/api/ai/usage', aiUsage)
app.get('/api/ai/sessions', aiSessions)
app.get('/api/ai/sessions/:id/messages', aiSessionMessages)
app.post('/api/admin/set-tier', aiSetTier)
```

Important: do **not** protect `/api/auth/*`. Better Auth sign-in, callback, and session-creation endpoints must remain public.

### 6. Simplify handlers in `ai.ts`

Update handler context types:

```ts
import type { Context } from 'hono'
import type { AuthEnv } from './auth'
```

Then change handlers from:

```ts
export async function aiUsage(c: Context): Promise<Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	// ...
}
```

to:

```ts
export async function aiUsage(c: Context<AuthEnv>): Promise<Response> {
	const session = c.get('session')
	// ...
}
```

Apply the same pattern to:

- `aiChat`
- `aiUsage`
- `aiSessions`
- `aiSessionMessages`
- `aiSetTier`

Remove this import from `ai.ts`:

```ts
import { auth } from './auth'
```

Remove the inline admin check from `aiSetTier`; admin authorization belongs to `requireAdmin`.

## Non-goals

- Do not change Better Auth provider configuration.
- Do not change CORS behavior except preserving the current order/scope.
- Do not protect `/api/auth/*`.
- Do not introduce compatibility wrappers or duplicate auth helpers.
- Do not create a new middleware module unless the local `server.ts` middleware becomes unwieldy.

## Acceptance criteria

- [ ] `auth.api.getSession(...)` is called in exactly one place for protected API routes: `requireSession` in `server.ts`.
- [ ] `/api/ai/*` routes return `401` when no valid session cookie or bearer token is provided.
- [ ] `/api/ai/*` routes still work for valid signed-in users.
- [ ] `/api/admin/*` routes return `401` for unauthenticated callers.
- [ ] `/api/admin/*` routes return `403` for authenticated non-admin users.
- [ ] `/api/admin/*` routes still work for authenticated admin users.
- [ ] `/api/auth/*` routes remain public and continue to be handled by `auth.handler(c.req.raw)`.
- [ ] `ai.ts` no longer imports `auth` and no longer performs inline session/admin checks.
- [ ] TypeScript/Hono context typing remains clean via `AuthEnv`.

## Verification commands

Use Bun only in this repo.

From the repository root:

```bash
bun test
```

If a package check/typecheck script exists, run the relevant Bun script, for example:

```bash
bun run check
```

If no global check script exists, at minimum verify the betterauth package with its available scripts from `libs/betterauth/package.json`.

## Suggested test coverage

If tests are added, prefer focused route-level tests around `server.ts` behavior:

1. unauthenticated `/api/ai/usage` returns `401`
2. authenticated `/api/ai/usage` reaches the handler path
3. unauthenticated `/api/admin/set-tier` returns `401`
4. authenticated non-admin `/api/admin/set-tier` returns `403`
5. `/api/auth/*` is not blocked by `requireSession`

Mock/stub Better Auth session retrieval rather than hitting real OAuth/provider flows.

## Implementation notes

The most important first-principles simplification is to make auth a property of the route tree, not of each handler. That reduces duplicate code, makes future routes safer by default, and keeps handlers focused on business behavior.
