/**
 * Streaming on-device generation client. Calls the `llm_generate` Tauri command
 * and relays the `llm:token` events it emits (tagged with our `replyId`) to an
 * `onToken` callback so the Talk UI can render the agent reply live. Resolves with
 * the full reply text when the stream completes.
 */

import type { LlmToolCall, ToolDef } from './tools'

/** Payload of the `llm:token` streaming event (see `app/src-tauri/src/llm.rs`). */
export type LlmToken = {
	replyId: string
	token: string
	done: boolean
}

/** Optional tool-calling wiring for {@link streamReply}. */
export type StreamReplyOptions = {
	/** Tools advertised to the model (LFM2 tool list); omit for a plain text reply. */
	tools?: ToolDef[]
	/** Fires once per tool call the model emits (tagged with our `replyId`). */
	onToolCall?: (call: LlmToolCall) => void
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Stream a reply for `prompt`. `onToken` fires for each decoded text piece tagged
 * with our `replyId`; the resolved string is the complete reply. When `opts.tools`
 * is given and the model calls one, `opts.onToolCall` fires (and the visible reply
 * is typically empty — single-turn). Throws outside Tauri or if the backend errors
 * (e.g. model not downloaded / runtime missing).
 */
export async function streamReply(
	prompt: string,
	replyId: string,
	onToken: (piece: string) => void,
	opts: StreamReplyOptions = {},
): Promise<string> {
	if (!isTauri()) throw new Error('on-device AI requires the desktop app')
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event'),
	])

	const unlisten = await listen<LlmToken>('llm:token', (e) => {
		const p = e.payload
		if (!p || p.replyId !== replyId || p.done) return
		if (p.token) onToken(p.token)
	})
	const unlistenTool = opts.onToolCall
		? await listen<LlmToolCall>('llm:tool-call', (e) => {
				const p = e.payload
				if (!p || p.replyId !== replyId) return
				opts.onToolCall?.(p)
			})
		: undefined
	try {
		return await invoke<string>('llm_generate', { prompt, replyId, tools: opts.tools ?? null })
	} finally {
		unlisten()
		unlistenTool?.()
	}
}
