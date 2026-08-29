import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'

export function setupSignIn(
	verify: (token: string) => Promise<{ userId: string } | null>
): BetterAuthPlugin {
	return {
		id: 'setup-sign-in',
		endpoints: {
			signInSetupToken: createAuthEndpoint(
				'/sign-in/setup-token',
				{
					method: 'GET',
					query: z.object({ token: z.string().min(32).max(256) })
				},
				async (ctx) => {
					const verified = await verify(ctx.query.token)
					const user = verified
						? await ctx.context.internalAdapter.findUserById(verified.userId)
						: null
					if (!user)
						throw new APIError('UNAUTHORIZED', { message: 'This setup link is unavailable.' })
					const session = await ctx.context.internalAdapter.createSession(user.id)
					if (!session)
						throw new APIError('UNAUTHORIZED', { message: 'Could not create a session.' })
					await setSessionCookie(ctx, { session, user })
					throw ctx.redirect('/dashboard')
				}
			)
		},
		rateLimit: [{ pathMatcher: (path) => path === '/sign-in/setup-token', window: 60, max: 20 }]
	}
}
