/**
 * Streaming on-device generation client. Calls the `llm_generate` Tauri command
 * and relays the `llm:token` events it emits (tagged with our `replyId`) to an
 * `onToken` callback so the Talk UI can render the agent reply live. Resolves with
 * the full reply text when the stream completes.
 */

/** Payload of the `llm:token` streaming event (see `app/src-tauri/src/llm.rs`). */
export type LlmToken = {
	replyId: string
	token: string
	done: boolean
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Stream a reply for `prompt`. `onToken` fires for each decoded text piece tagged
 * with our `replyId`; the resolved string is the complete reply. Throws outside
 * Tauri or if the backend errors (e.g. model not downloaded / runtime missing).
 */
export async function streamReply(
	prompt: string,
	replyId: string,
	onToken: (piece: string) => void,
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
	try {
		return await invoke<string>('llm_generate', { prompt, replyId })
	} finally {
		unlisten()
	}
}
