import { json } from '@sveltejs/kit'
import { readAvenConversation } from '$lib/aven/conversation-store.js'
import { buildAvenChatRoundContext } from '$lib/aven/live-context.js'
import { maiaAgent } from '$lib/aven/maia-agent'
import tinfoilChatConfig from '$lib/aven/tinfoil-chat.config.json' with { type: 'json' }
import type { RequestHandler } from './$types'

function defaultChatModel(): string {
	const m = typeof maiaAgent.llm.defaultModel === 'string' ? maiaAgent.llm.defaultModel.trim() : ''
	if (m.length > 0) return m
	const v = tinfoilChatConfig.chatModel
	return typeof v === 'string' && v.trim().length > 0 ? v.trim() : 'glm-5-1'
}

export const GET: RequestHandler = () => {
	const messages = readAvenConversation()
	const model = defaultChatModel()
	const { preview, fullContext } = buildAvenChatRoundContext(model, messages)
	return json({
		ok: true as const,
		messages,
		contextPreview: preview,
		fullContext
	})
}
