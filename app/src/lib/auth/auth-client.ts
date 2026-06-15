import { createAuthClient } from 'better-auth/svelte'

/**
 * Client for the self-hosted Better Auth server (libs/betterauth). Points at
 * PUBLIC_BETTER_AUTH_URL (the auth server origin, e.g. http://localhost:8787) — a
 * different origin than the app, so the server sets SameSite=None cookies and allows
 * this origin via CORS + trustedOrigins. Used by the mainnet AuthGate (board 0050).
 */
export const authClient = createAuthClient({
	baseURL: import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined
})
