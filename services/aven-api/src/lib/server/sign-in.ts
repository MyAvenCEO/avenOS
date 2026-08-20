// Better Auth adapter for the reusable post-purchase setup link and the
// one-time payment-success bridge.

import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { z } from 'zod'

export interface SetupSignInVerifiers {
	verifySetupLogin(token: string): Promise<{ userId: string } | null>
	verifyPurchaseLogin(token: string): Promise<{ userId: string } | null>
}

export function setupSignIn(verifiers: SetupSignInVerifiers): BetterAuthPlugin {
	return {
		id: 'setup-sign-in',
		endpoints: {
			// One-time token from the payment success redirect: the success page
			// polls this until the webhook grant deposits the token, then the buyer
			// lands signed-in on the dashboard without touching their inbox.
			signInPurchaseToken: createAuthEndpoint(
				'/sign-in/purchase-token',
				{
					method: 'POST',
					body: z.object({ token: z.string().min(8).max(128) })
				},
				async (ctx) => {
					const verified = await verifiers.verifyPurchaseLogin(ctx.body.token)
					const user = verified
						? await ctx.context.internalAdapter.findUserById(verified.userId)
						: null
					if (!user)
						throw new APIError('UNAUTHORIZED', { message: 'The purchase is not confirmed yet.' })
					const session = await ctx.context.internalAdapter.createSession(user.id)
					if (!session)
						throw new APIError('UNAUTHORIZED', { message: 'Could not create a session.' })
					await setSessionCookie(ctx, { session, user })
					return ctx.json({ user: { id: user.id, email: user.email, name: user.name } })
				}
			),
			signInSetupToken: createAuthEndpoint(
				'/sign-in/setup-token',
				{
					method: 'GET',
					query: z.object({ token: z.string().min(8).max(128) })
				},
				async (ctx) => {
					const verified = await verifiers.verifySetupLogin(ctx.query.token)
					const user = verified
						? await ctx.context.internalAdapter.findUserById(verified.userId)
						: null
					if (!user) throw ctx.redirect('/login?access=invalid')
					const session = await ctx.context.internalAdapter.createSession(user.id)
					if (!session) throw ctx.redirect('/login?access=invalid')
					await setSessionCookie(ctx, { session, user })
					throw ctx.redirect('/dashboard')
				}
			)
		},
		rateLimit: [
			{ pathMatcher: (path: string) => path === '/sign-in/setup-token', window: 60, max: 20 },
			{ pathMatcher: (path: string) => path === '/sign-in/purchase-token', window: 60, max: 60 }
		]
	}
}
