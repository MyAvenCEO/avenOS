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
	opts: StreamReplyOptions = {}
): Promise<string> {
	if (!isTauri()) throw new Error('on-device AI requires the desktop app')
	const [{ invoke }, { listen }] = await Promise.all([
		import('@tauri-apps/api/core'),
		import('@tauri-apps/api/event')
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

// ───────────────────────── Tinfoil confidential cloud chat ─────────────────────────
//
// The cloud counterpart to the on-device path: one OpenAI-style chat completion round per
// call (the TOOL LOOP lives in the caller — see `identity-agent`). Thin invoke wrappers over
// the `tinfoil_available` / `tinfoil_chat` Tauri commands (board 0021).

/** One tool call the cloud model requested this round (mirrors `aven_ai::tinfoil::ToolCallOut`). */
export type CloudToolCall = { id: string; name: string; arguments: unknown }

/** Result of one cloud chat round (mirrors `aven_ai::tinfoil::ChatTurn`). `assistantRaw` is the
 *  raw OpenAI assistant message to re-append verbatim before sending tool results back. */
export type CloudChatTurn = {
	content: string | null
	toolCalls: CloudToolCall[]
	assistantRaw: unknown
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	if (!isTauri()) throw new Error('cloud AI requires the desktop app')
	const { invoke } = await import('@tauri-apps/api/core')
	return invoke<T>(cmd, args)
}

/** Whether the Tinfoil cloud path can run (feature compiled + `TINFOIL_API_KEY` set). */
export async function tinfoilAvailable(): Promise<boolean> {
	if (!isTauri()) return false
	try {
		return await tauriInvoke<boolean>('tinfoil_available')
	} catch {
		return false
	}
}

/**
 * Run ONE cloud chat completion round. `messages` is the full OpenAI conversation so far
 * (verbatim), `tools` the OpenAI `tools` array (omit/empty forces a plain-text reply). Throws
 * outside Tauri or if the enclave call fails.
 */
export async function tinfoilChat(messages: unknown[], tools?: unknown[]): Promise<CloudChatTurn> {
	return tauriInvoke<CloudChatTurn>('tinfoil_chat', {
		messages,
		tools: tools && tools.length > 0 ? tools : null
	})
}
