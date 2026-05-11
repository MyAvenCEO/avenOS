import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import {
	createFsStorage,
	loadSkillDocs,
	LocalSandboxFactory,
	runJaensenTurn,
	type JaensenInput
} from '@avenos/jaensen-bot'
import { mapIntentToOrchestrator } from '$lib/jaensen/map-intent-to-orchestrator.js'
import type { RequestHandler } from './$types'

const JAENSEN_DATA_DIR = '/home/daniel/src/oMaiaCity/AvenOS/projects/aven-ceo/.data/jaensen'
const JAENSEN_PACKAGE_DIR = '/home/daniel/src/oMaiaCity/AvenOS/projects/jaensen-bot'

async function generate(prompt: string): Promise<string> {
	console.log('[aven-ceo][jaensen] llm:request', { promptPreview: prompt.slice(0, 200) })
	const baseUrl = env.OPENAI_BASE_URL?.trim()
	const apiKey = env.OPENAI_API_KEY?.trim()
	const model = env.DEFAULT_MODEL?.trim()
	if (!baseUrl || !apiKey || !model) {
		throw new Error('Jaensen LLM env is not fully configured.')
	}
	const response = await fetch(`${baseUrl.replace(/\/$/, '')}/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${apiKey}`
		},
		body: JSON.stringify({ model, prompt, temperature: 0.2, max_tokens: 900 })
	})
	if (!response.ok) {
		throw new Error(`Jaensen completion failed: ${response.status} ${await response.text()}`)
	}
	const json = (await response.json()) as { choices?: Array<{ text?: string }> }
	console.log('[aven-ceo][jaensen] llm:response', { textPreview: (json.choices?.[0]?.text ?? '').slice(0, 200) })
	return json.choices?.[0]?.text ?? ''
}

export const POST: RequestHandler = async ({ request }) => {
	console.log('[aven-ceo][jaensen] chat:incoming')
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}

	const input = raw as JaensenInput
	console.log('[aven-ceo][jaensen] chat:payload', {
		from: input?.from,
		subject: input?.subject,
		messagePreview: typeof input?.message === 'string' ? input.message.slice(0, 160) : null,
		hasAttachment: Boolean(input?.attachment)
	})
	if (!input || typeof input.message !== 'string' || input.message.trim().length === 0) {
		return json({ ok: false as const, error: 'message is required' }, { status: 400 })
	}

	try {
		const storage = await createFsStorage(JAENSEN_DATA_DIR)
		const skillDocs = await loadSkillDocs(JAENSEN_PACKAGE_DIR)
		console.log('[aven-ceo][jaensen] chat:runtime-ready', { dataDir: JAENSEN_DATA_DIR })
		const result = await runJaensenTurn(input, {
			storage,
			sandboxFactory: new LocalSandboxFactory(`${JAENSEN_DATA_DIR}/sandboxes`),
			skillDocs,
			generate
		})
		return json({
			ok: true as const,
			reply: result.response,
			intent: mapIntentToOrchestrator(result.primaryIntent),
			intents: result.relevantIntents.map(mapIntentToOrchestrator),
			humanNotification: result.humanNotification
		})
	} catch (error) {
		console.error('[aven-ceo][jaensen] chat:error', error)
		return json({ ok: false as const, error: error instanceof Error ? error.message : String(error) }, { status: 500 })
	}
}