import { type ChatMessage, streamChat } from './redpill'

/**
 * The dashboard's chat state.
 *
 * One conversation, held in memory. The assistant's message is appended empty
 * and then grown token by token, so the UI renders the reply as it is written
 * rather than after it finishes.
 */

const SYSTEM_PROMPT =
	'Du bist avenOS, ein knapper und direkter Assistent. Antworte immer auf Deutsch, ' +
	'in wenigen Sätzen, sofern nicht mehr verlangt wird. Antworte in reinem Fließtext ' +
	'ohne Markdown, Listen oder Emojis — deine Antwort wird vorgelesen.'

export interface Turn extends ChatMessage {
	id: string
}

/** Hooks for anything that wants the reply as it arrives — the speaker, today. */
export interface ChatSink {
	onDelta?: (text: string) => void
	onDone?: () => void
}

let nextId = 0
const id = () => `t${nextId++}`

export class Chat {
	/** Everything the user sees. The system prompt is deliberately not in here. */
	turns = $state<Turn[]>([])
	/** True from the moment we send until the last token lands. */
	streaming = $state(false)
	/** Set when a request fails, cleared on the next send. */
	failure = $state<string | null>(null)

	#abort: AbortController | null = null
	#sink: ChatSink

	constructor(sink: ChatSink = {}) {
		this.#sink = sink
	}

	get canSend(): boolean {
		return !this.streaming
	}

	async send(text: string): Promise<void> {
		const prompt = text.trim()
		if (prompt === '' || this.streaming) return

		this.failure = null
		this.turns.push({ id: id(), role: 'user', content: prompt })

		// Push first, then take the reference back OUT of the array. `turns` is a
		// `$state` proxy: it hands out a proxied view on read, and only writes
		// through that view are tracked. Holding on to the object literal we
		// pushed and mutating it would update the data and tell no one — the
		// reply would stream into a bubble that never re-renders.
		const replyId = id()
		this.turns.push({ id: replyId, role: 'assistant', content: '' })
		const reply = this.turns[this.turns.length - 1]

		this.streaming = true
		this.#abort = new AbortController()

		try {
			const history: ChatMessage[] = [
				{ role: 'system', content: SYSTEM_PROMPT },
				// `reply` is already in `turns` and is still empty — sending it would
				// hand the model a trailing blank assistant turn.
				...this.turns.slice(0, -1).map(({ role, content }) => ({ role, content }))
			]

			for await (const delta of streamChat(history, this.#abort.signal)) {
				reply.content += delta
				this.#sink.onDelta?.(delta)
			}
			this.#sink.onDone?.()
		} catch (err) {
			if (!this.#abort?.signal.aborted) {
				this.failure = err instanceof Error ? err.message : String(err)
				// Drop the stub rather than leaving an empty bubble behind. A reply
				// that got partway through is kept — it is still worth reading.
				if (reply.content === '') this.turns = this.turns.filter((t) => t.id !== replyId)
			}
		} finally {
			this.streaming = false
			this.#abort = null
		}
	}

	/** Stop mid-reply. Whatever has arrived so far stays on screen. */
	stop(): void {
		this.#abort?.abort()
	}

	clear(): void {
		this.stop()
		this.turns = []
		this.failure = null
	}
}
