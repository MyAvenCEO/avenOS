import { createFsStorage } from '@avenos/jaensen-bot'
import { json } from '@sveltejs/kit'
import { mapIntentToOrchestrator } from '$lib/jaensen/map-intent-to-orchestrator.js'
import { JAENSEN_DATA_DIR } from '$lib/jaensen/paths'
import type { RequestHandler } from './$types'

export const GET: RequestHandler = async () => {
	console.log('[aven-ceo][jaensen] intents:list')
	try {
		const storage = await createFsStorage(JAENSEN_DATA_DIR)
		const intents = await storage.intents.listActive()
		console.log(
			'[aven-ceo][jaensen] intents:list:result',
			intents.map((intent) => ({ id: intent.id, title: intent.title, status: intent.status }))
		)
		return json({ ok: true as const, intents: intents.map(mapIntentToOrchestrator) })
	} catch (err) {
		console.error('[aven-ceo][jaensen] intents:error', err)
		const message = err instanceof Error ? err.message : String(err)
		return json({ ok: false as const, error: message, intents: [] }, { status: 500 })
	}
}
