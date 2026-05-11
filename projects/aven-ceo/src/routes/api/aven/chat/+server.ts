import { json } from '@sveltejs/kit'
import { env } from '$env/dynamic/private'
import { persistAvenMessageTurn } from '$lib/aven/chat-message-log.js'
import { avenChatBodySchema } from '$lib/aven/chat-request.js'
import { writeAvenConversation } from '$lib/aven/conversation-store.js'
import { maiaAgent } from '$lib/aven/maia-agent'
import { type ChatStreamEvent, runAvenChat, streamAvenChat } from '$lib/aven/run-aven-chat.js'
import tinfoilChatConfig from '$lib/aven/tinfoil-chat.config.json' with { type: 'json' }
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return json({ ok: false as const, error: 'Expected JSON body.' }, { status: 400 })
	}

	const parsed = avenChatBodySchema.safeParse(raw)
	if (!parsed.success) {
		return json({ ok: false as const, error: parsed.error.message }, { status: 400 })
	}

	const apiKey = env.TINFOIL_API_KEY?.trim()
	if (!apiKey) {
		return json(
			{ ok: false as const, error: 'TINFOIL_API_KEY is not configured on the server.' },
			{ status: 503 }
		)
	}

	const fromMaia =
		typeof maiaAgent.llm.defaultModel === 'string' && maiaAgent.llm.defaultModel.trim().length > 0
			? maiaAgent.llm.defaultModel.trim()
			: ''
	const fromTinfoilLegacy =
		typeof tinfoilChatConfig.chatModel === 'string' && tinfoilChatConfig.chatModel.trim().length > 0
			? tinfoilChatConfig.chatModel.trim()
			: ''

	const fallbackChatModel = fromMaia || fromTinfoilLegacy || 'glm-5-1'
	const model = (parsed.data.model ?? fallbackChatModel).trim()

	if (parsed.data.stream === true) {
		const encoder = new TextEncoder()
		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				function send(ev: ChatStreamEvent) {
					controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`))
				}
				try {
					for await (const ev of streamAvenChat(parsed.data.messages, apiKey, model)) {
						if (ev.type === 'done') {
							const full = [
								...parsed.data.messages,
								{ role: 'assistant' as const, content: ev.reply }
							]
							try {
								persistAvenMessageTurn({
									messages: parsed.data.messages,
									assistantReply: ev.reply,
									model: ev.model
								})
								writeAvenConversation(full)
							} catch (err) {
								console.error('[aven/chat] persist conversation / message log failed', err)
							}
						}
						send(ev)
					}
				} catch (e) {
					const message = e instanceof Error ? e.message : String(e)
					send({ type: 'error', message, status: 500 })
				} finally {
					controller.close()
				}
			}
		})
		return new Response(stream, {
			headers: {
				'Content-Type': 'application/x-ndjson; charset=utf-8',
				'Cache-Control': 'no-store'
			}
		})
	}

	const result = await runAvenChat(parsed.data.messages, apiKey, model)

	if (!result.ok) {
		return json({ ok: false as const, error: result.message }, { status: result.status })
	}

	const full = [...parsed.data.messages, { role: 'assistant' as const, content: result.reply }]
	try {
		persistAvenMessageTurn({
			messages: parsed.data.messages,
			assistantReply: result.reply,
			model
		})
		writeAvenConversation(full)
	} catch (err) {
		console.error('[aven/chat] persist conversation / message log failed', err)
	}

	return json({ ok: true as const, reply: result.reply, model })
}
