import { json } from '@sveltejs/kit'
import { z } from 'zod'
import { runtime } from '$lib/server/runtime.js'
import { constantTimeAnyBearer } from '$lib/server/tokens.js'

const browserLanguageSchema = z
	.string()
	.trim()
	.min(1)
	.max(255)
	.transform((value, context) => {
		try {
			return Intl.getCanonicalLocales(value)[0]
		} catch {
			context.addIssue({ code: 'custom', message: 'Invalid browser language.' })
			return z.NEVER
		}
	})

const requestSchema = z.object({
	email: z.email(),
	source: z.string().min(1).max(80),
	browserLanguage: browserLanguageSchema.optional()
})
export const POST = async ({ request }) => {
	const rt = await runtime()
	if (!constantTimeAnyBearer(request, rt.config.IDENTITY_PROVISIONING_SECRETS))
		return json({ code: 'UNAUTHORIZED' }, { status: 401 })
	try {
		const input = requestSchema.parse(await request.json())
		const account = await rt.accounts.provisionVerified(input.email, input.browserLanguage)
		const setupToken = await rt.passkeys.issueSetupLink(account.id)
		const setupUrl = setupToken
			? new URL(
					`/api/auth/sign-in/setup-token?token=${encodeURIComponent(setupToken)}`,
					rt.config.PUBLIC_BASE_URL
				).href
			: null
		return json({ account, setupUrl }, { status: 200 })
	} catch (error) {
		rt.logger.warn({ err: error }, 'account provisioning rejected')
		return json(
			{ code: 'INVALID_ACCOUNT_PROVISIONING_REQUEST', message: 'The account request is invalid.' },
			{ status: 400 }
		)
	}
}
