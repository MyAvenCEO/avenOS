import { Buffer } from 'node:buffer'
import {
	createFsStorage,
	type JaensenInput,
	LocalSandboxFactory,
	loadSkillRegistry,
	runJaensenTurn
} from '@avenos/jaensen-bot'
import { json } from '@sveltejs/kit'
import { TinfoilAI } from 'tinfoil'
import { env } from '$env/dynamic/private'
import { mapIntentToOrchestrator } from '$lib/jaensen/map-intent-to-orchestrator.js'
import {
	AVENOS_SANDBOXES_DIR,
	JAENSEN_DATA_DIR,
	JAENSEN_DOCUMENT_DIR,
	JAENSEN_PACKAGE_DIR
} from '$lib/jaensen/paths'
import type { RequestHandler } from './$types'

function resolveJaensenLlmConfig() {
	const hasTinfoil = Boolean(env.JAENSEN_TINFOIL_API_KEY?.trim())
	const hasOpenAiCompat = Boolean(
		env.JAENSEN_OPENAI_BASE_URL?.trim() || env.JAENSEN_OPENAI_API_KEY?.trim()
	)

	if (hasTinfoil && hasOpenAiCompat) {
		throw new Error(
			'Jaensen provider configuration is ambiguous. Configure exactly one provider prefix: JAENSEN_TINFOIL_* or JAENSEN_OPENAI_*.'
		)
	}

	if (hasTinfoil) {
		return {
			provider: 'tinfoil' as const,
			baseUrl: (env.JAENSEN_TINFOIL_BASE_URL?.trim() || 'https://api.tinfoil.sh/v1').replace(
				/\/$/,
				''
			),
			apiKey: env.JAENSEN_TINFOIL_API_KEY?.trim() || '',
			model: env.JAENSEN_TINFOIL_MODEL?.trim() || 'glm-5-1'
		}
	}

	return {
		provider: 'openai-compatible' as const,
		baseUrl: (env.JAENSEN_OPENAI_BASE_URL?.trim() || 'http://box:8000/v1').replace(/\/$/, ''),
		apiKey: env.JAENSEN_OPENAI_API_KEY?.trim() || 'local',
		model: env.JAENSEN_OPENAI_MODEL?.trim() || 'minimax-m2.7-nvfp4'
	}
}

async function generate(prompt: string): Promise<string> {
	console.log('[aven-ceo][jaensen] llm:request', { promptPreview: prompt.slice(0, 200) })
	const { provider, baseUrl, apiKey, model } = resolveJaensenLlmConfig()
	if (!baseUrl || !apiKey || !model) {
		throw new Error('Jaensen LLM env is not fully configured.')
	}

	if (provider === 'tinfoil') {
		const client = new TinfoilAI({ apiKey })
		await client.ready()
		const completion = await client.chat.completions.create({
			model,
			temperature: 0.2,
			messages: [{ role: 'user', content: prompt }],
			max_tokens: 900
		})
		const text = completion.choices?.[0]?.message?.content?.trim() ?? ''
		console.log('[aven-ceo][jaensen] llm:response', { textPreview: text.slice(0, 200) })
		return text
	}

	const response = await fetch(`${baseUrl}/completions`, {
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
	console.log('[aven-ceo][jaensen] llm:response', {
		textPreview: (json.choices?.[0]?.text ?? '').slice(0, 200)
	})
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
		let hydratedInput: JaensenInput = input
		if (input.attachment?.base64) {
			const content = Buffer.from(input.attachment.base64, 'base64')
			const archived = await storage.archive.put({
				content,
				contentType: input.attachment.contentType,
				metadata: {
					name: input.attachment.name,
					source: 'owner-upload'
				}
			})
			hydratedInput = {
				...input,
				metadata: {
					...(input.metadata ?? {}),
					attachmentArchiveKey: archived.key
				},
				attachment: {
					archiveKey: archived.key,
					name: input.attachment.name,
					contentType: input.attachment.contentType
				}
			}
			console.log('[aven-ceo][jaensen] chat:attachment-archived', {
				key: archived.key,
				name: input.attachment.name,
				contentType: input.attachment.contentType,
				size: content.byteLength
			})
		}
		if (
			hydratedInput.metadata?.attachment &&
			typeof hydratedInput.metadata.attachment === 'object'
		) {
			const {
				base64: _base64,
				content: _content,
				...restAttachment
			} = hydratedInput.metadata.attachment as Record<string, unknown>
			hydratedInput = {
				...hydratedInput,
				metadata: {
					...hydratedInput.metadata,
					attachment: restAttachment
				}
			}
		}
		const skillRegistry = await loadSkillRegistry(JAENSEN_PACKAGE_DIR)
		console.log('[aven-ceo][jaensen] chat:runtime-ready', {
			dataDir: JAENSEN_DATA_DIR,
			sandboxesDir: AVENOS_SANDBOXES_DIR
		})
		const result = await runJaensenTurn(hydratedInput, {
			storage,
			sandboxFactory: new LocalSandboxFactory(AVENOS_SANDBOXES_DIR, JAENSEN_DOCUMENT_DIR),
			skillRegistry,
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
		return json(
			{ ok: false as const, error: error instanceof Error ? error.message : String(error) },
			{ status: 500 }
		)
	}
}
