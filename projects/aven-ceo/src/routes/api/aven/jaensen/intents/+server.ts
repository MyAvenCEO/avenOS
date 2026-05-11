import { json } from '@sveltejs/kit'
import { createFsStorage } from '@avenos/jaensen-bot'
import { mapIntentToOrchestrator } from '$lib/jaensen/map-intent-to-orchestrator.js'
import type { RequestHandler } from './$types'

const JAENSEN_DATA_DIR = '/home/daniel/src/oMaiaCity/AvenOS/projects/aven-ceo/.data/jaensen'

export const GET: RequestHandler = async () => {
	console.log('[aven-ceo][jaensen] intents:list')
	const storage = await createFsStorage(JAENSEN_DATA_DIR)
	const intents = await storage.intents.listActive()
	console.log('[aven-ceo][jaensen] intents:list:result', intents.map((intent) => ({ id: intent.id, title: intent.title, status: intent.status })))
	return json({ ok: true as const, intents: intents.map(mapIntentToOrchestrator) })
}