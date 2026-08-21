import type { RequestEvent } from '@sveltejs/kit'
import { json } from '@sveltejs/kit'
import { writeAudit } from '$lib/server/audit.js'
import { type PaymentEvent, parseCreemSubscriptionEvent } from '$lib/server/billing/provider.js'
import { AppError } from '$lib/server/errors.js'
import { runtime } from '$lib/server/runtime.js'

export const POST = async (event: RequestEvent) => {
	const rt = await runtime()
	const rawBody = await event.request.text()
	let paymentEvent: PaymentEvent
	try {
		paymentEvent = rt.payments.verifyWebhook(rawBody, event.request.headers.get('creem-signature'))
	} catch (error) {
		if (error instanceof AppError)
			return json({ code: error.code, message: error.message }, { status: error.status })
		throw error
	}
	try {
		if (paymentEvent.type === 'checkout.completed') {
			// A checkout can complete for a NAME (carries holdId) or for a
			// subscription tier (carries tier/userId). Only the name path grants
			// here — subscription state arrives via its own subscription.* event.
			if (paymentEvent.metadata.holdId) {
				await rt.names.grantFromEvent(paymentEvent)
			} else {
				await writeAudit(rt.database.pool, {
					eventType: 'billing.subscription_checkout_completed',
					metadata: { eventId: paymentEvent.id, tier: paymentEvent.metadata.tier ?? null }
				})
			}
		} else if (paymentEvent.type.startsWith('subscription.')) {
			const subscriptionEvent = parseCreemSubscriptionEvent(rawBody)
			if (subscriptionEvent) await rt.subscriptions.applyEvent(subscriptionEvent)
		} else if (paymentEvent.type === 'refund.created' || paymentEvent.type === 'dispute.created') {
			await rt.names.revokeFromEvent(paymentEvent)
		} else {
			await writeAudit(rt.database.pool, {
				eventType: 'billing.event_ignored',
				metadata: { eventId: paymentEvent.id, type: paymentEvent.type }
			})
		}
	} catch (error) {
		// Non-2xx makes the provider retry with backoff — exactly what we want
		// for transient failures; the grant itself is idempotent.
		rt.logger.error(
			{ err: error, eventId: paymentEvent.id, type: paymentEvent.type },
			'webhook processing failed'
		)
		return json({ received: false }, { status: 500 })
	}
	return json({ received: true })
}
