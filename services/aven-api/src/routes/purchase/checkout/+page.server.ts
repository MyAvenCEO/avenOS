import { error as httpError, redirect } from '@sveltejs/kit'
import { AppError } from '$lib/server/errors.js'
import { rateLimit } from '$lib/server/rate-limit.js'
import { runtime } from '$lib/server/runtime.js'
import { designerCheckout, designerMode } from '$lib/designer.js'
import type { PageServerLoad } from './$types.js'

// The emailed token is the sole credential for this page. Resolving it proves
// inbox control, starts the short reservation, and lazily creates one checkout
// session. The provider URL is safe to expose in the browser, but never appears
// in the email or the public hold API.
export const load: PageServerLoad = async (event) => {
	if (designerMode) return designerCheckout
	if (!rateLimit(`names-claim:${event.getClientAddress()}`, 20, 60_000))
		redirect(303, '/purchase/expired')

	const { names, payments, config } = await runtime()
	try {
		const checkout = await names.claim(event.url.searchParams.get('token') ?? '')
		return {
			...checkout,
			provider: payments.kind,
			priceEur: config.NAME_PRICE_EUR,
			reservationMinutes: config.NAME_RESERVATION_TTL_MINUTES
		}
	} catch (error) {
		if (!(error instanceof AppError)) throw error
		// Invalid, expired, or competing claims share the neutral expired page.
		// Provider/infrastructure failures retain their real status so a valid
		// buyer is not incorrectly told to request a new link.
		if (error.status >= 500) httpError(error.status, { message: error.message })
		redirect(303, '/purchase/expired')
	}
}
