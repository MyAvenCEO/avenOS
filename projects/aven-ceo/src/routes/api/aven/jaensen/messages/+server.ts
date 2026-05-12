import { json } from '@sveltejs/kit'

import type { RequestHandler } from './$types'
import { normalizeMessageAttachments } from '$lib/jaensen/message-attachments'
import { resolveJaensenWebApiBaseUrl } from '../_shared'

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ error: 'Expected JSON body.' }, { status: 400 })
	}

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return json({ error: 'Body must be an object.' }, { status: 400 })
	}

	const body = raw as {
		text?: string
		intentIdHint?: string
		attachments?: unknown[]
		attachment?: unknown
	}

	const text = typeof body.text === 'string' ? body.text.trim() : ''
	if (!text) {
		return json({ error: 'text is required.' }, { status: 400 })
	}

	const response = await fetch(`${resolveJaensenWebApiBaseUrl()}/api/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			text,
			intentIdHint: typeof body.intentIdHint === 'string' ? body.intentIdHint : undefined,
			attachments: normalizeMessageAttachments({
				attachments: body.attachments,
				attachment: body.attachment
			})
		})
	})

	const payload = await response.text()
	return new Response(payload, {
		status: response.status,
		headers: {
			'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8'
		}
	})
}