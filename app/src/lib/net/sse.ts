// THE single SSE/event-stream reader for the app. One DRY primitive, used by every streaming
// subscription alike — the realtime change stream (query/events) and the AI chat token stream
// (MainnetChat). EventSource can't send the bearer Authorization header (WKWebView drops the
// cross-site cookie), so everything streams over `fetch` + a ReadableStream reader. board 0055.

/**
 * Read an event-stream `Response` body, invoking `onData` with each frame's `data:` payload.
 * Resolves when the server closes the stream. `onChunk` fires on every raw read (used to feed an
 * idle-timeout watchdog). If the underlying fetch was aborted, `reader.read()` rejects and this
 * throws — callers wrap it so a stalled stream always unwinds (never wedges the UI). board 0055.
 */
export async function consumeSse(
	res: Response,
	onData: (data: string) => void,
	onChunk?: () => void
): Promise<void> {
	if (!res.body) return
	const reader = res.body.getReader()
	const decoder = new TextDecoder()
	let buf = ''
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		onChunk?.()
		buf += decoder.decode(value, { stream: true })
		const frames = buf.split('\n\n')
		buf = frames.pop() ?? ''
		for (const frame of frames) {
			const line = frame.split('\n').find((l) => l.startsWith('data:'))
			if (line) onData(line.slice(5).trim())
		}
	}
}
