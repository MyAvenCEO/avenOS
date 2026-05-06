import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { postIntentBodySchema } from '$lib/aven/intent-request'
import { runIntentClassification } from '$lib/aven/run-intent'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}

	const parsed = postIntentBodySchema.safeParse(raw)
	if (!parsed.success) {
		const snap =
			typeof raw === 'object' &&
			raw !== null &&
			'snapshot' in raw &&
			typeof (raw as { snapshot?: { responsesInvalidBody?: string } }).snapshot === 'object'
				? (raw as { snapshot?: { responsesInvalidBody?: string } }).snapshot
				: undefined
		const msg = snap?.responsesInvalidBody ?? parsed.error.message
		return json({ ok: false as const, error: msg }, { status: 400 })
	}

	const { intent, snapshot } = parsed.data
	const apiKey = env.TINFOIL_API_KEY?.trim()
	if (!apiKey) {
		const msg = snapshot.responsesMissingApiKey ?? 'TINFOIL_API_KEY is not configured.'
		return json({ ok: false as const, error: msg }, { status: 503 })
	}

	const result = await runIntentClassification(intent, snapshot, apiKey)
	if (!result.ok) {
		return json({ ok: false as const, error: result.message }, { status: result.status })
	}

	return json({
		ok: true as const,
		classification: result.args,
		rawToolArguments: result.rawToolArguments
	})
}
