import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>
	try {
		body = await request.json()
	} catch {
		return json({ ok: false, error: 'invalid_json' }, { status: 400 })
	}

	// Honeypot — bots only
	if (body.website) {
		return json({ ok: true })
	}

	const email = typeof body.email === 'string' ? body.email.trim().slice(0, 320) : ''
	if (!email || !EMAIL_RE.test(email)) {
		return json({ ok: false, error: 'email_invalid' }, { status: 400 })
	}

	const payload = {
		email,
		name: typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '',
		newsletter: Boolean(body.newsletter),
		intent: typeof body.intent === 'string' ? body.intent.slice(0, 64) : '',
		preferredName:
			typeof body.preferredName === 'string' ? body.preferredName.trim().slice(0, 48) : '',
		tier: typeof body.tier === 'string' ? body.tier.slice(0, 32) : '',
		ts: new Date().toISOString()
	}

	const webhook = process.env.WAITLIST_WEBHOOK_URL
	if (webhook) {
		await fetch(webhook, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text: `AvenCEO waitlist\n\`\`\`${JSON.stringify(payload, null, 2)}\`\`\``
			})
		}).catch(() => {})
	} else {
		console.info('[waitlist]', payload)
	}

	return json({ ok: true })
}
