import { type ChatMessage, streamChat, type ToolSpec } from './redpill'

/**
 * The dashboard's conversation.
 *
 * Two histories, deliberately: `turns` is what a person sees, and `#wire` is
 * what the model sees — the same exchange plus the tool calls and their
 * results, which nobody wants rendered as chat bubbles but the model needs in
 * order to know what it already did.
 *
 * A turn is not finished when the first response ends. If the model asked for
 * tools, they are run and the whole thing is sent back so it can answer with
 * the results in hand; that repeats until it replies with prose.
 */

/**
 * The five-word rule earns its place: nothing is spoken until a sentence
 * boundary arrives, so the opening sentence's length sets the time to first
 * audio. A short one is synthesized and playing while the rest is still being
 * written, and the reply begins in a fraction of the time.
 */
const SYSTEM_PROMPT =
	'Du bist avenOS, ein knapper und direkter Assistent mit einer Aufgabenliste. ' +
	'Antworte immer auf Deutsch, in reinem Fließtext ohne Markdown, Listen oder ' +
	'Emojis — deine Antwort wird vorgelesen. ' +
	'Dein erster Satz ist immer sehr kurz, höchstens fünf Wörter, und endet mit ' +
	'einem Punkt: eine knappe Bestätigung oder ein Einstieg wie „Klar, einen Moment." ' +
	'Alles Weitere kommt in den Sätzen danach. ' +
	'Du änderst die Liste ausschließlich über die Werkzeuge, nie aus dem Gedächtnis, ' +
	'und rufst todo_list auf, bevor du über die Liste sprichst. ' +
	'Behaupte niemals, etwas eingetragen, geändert, abgehakt oder gelöscht zu haben, ' +
	'ohne im selben Zug das passende Werkzeug aufzurufen — eine Bestätigung ohne ' +
	'Werkzeugaufruf ist eine Lüge. Sagt jemand, etwas sei erledigt, rufe todo_update ' +
	'mit done=true auf. Lies Listen als Fließtext vor.'

/** Hard stop on tool rounds, so a model that keeps calling cannot loop forever. */
const MAX_TOOL_ROUNDS = 4

export interface Turn {
	id: string
	role: 'user' | 'assistant'
	content: string
	/** Names of tools run during this turn, for the transcript. */
	tools?: string[]
}

/** Hooks for anything that wants the reply as it arrives — the speaker, today. */
export interface ChatSink {
	onDelta?: (text: string) => void
	onDone?: () => void
}

export interface ChatTools {
	specs: ToolSpec[]
	run: (name: string, args: string) => string
}

let nextId = 0
const id = () => `t${nextId++}`

export class Chat {
	turns = $state<Turn[]>([])
	streaming = $state(false)
	failure = $state<string | null>(null)

	#wire: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }]
	#abort: AbortController | null = null
	#sink: ChatSink
	#tools: ChatTools

	constructor(sink: ChatSink = {}, tools: ChatTools = { specs: [], run: () => '' }) {
		this.#sink = sink
		this.#tools = tools
	}

	get canSend(): boolean {
		return !this.streaming
	}

	async send(text: string): Promise<void> {
		const prompt = text.trim()
		if (prompt === '' || this.streaming) return

		this.failure = null
		this.turns.push({ id: id(), role: 'user', content: prompt })
		this.#wire.push({ role: 'user', content: prompt })

		// Push first, then take the reference back OUT of the array. `turns` is a
		// `$state` proxy: it hands out a proxied view on read, and only writes
		// through that view are tracked. Holding on to the object literal we
		// pushed and mutating it would update the data and tell no one — the
		// reply would stream into a bubble that never re-renders.
		const replyId = id()
		this.turns.push({ id: replyId, role: 'assistant', content: '', tools: [] })
		const reply = this.turns[this.turns.length - 1]

		this.streaming = true
		this.#abort = new AbortController()

		try {
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				const calls = await this.#round(reply)
				if (calls.length === 0) break

				// Results go back as a user turn. See ChatMessage — a `tool` role
				// makes this model answer with nothing at all.
				const results = calls.map((call) => {
					reply.tools?.push(call.name)
					return `${call.name} → ${this.#tools.run(call.name, call.arguments)}`
				})
				this.#wire.push({
					role: 'user',
					content: `Ergebnis der Werkzeuge:\n${results.join('\n')}`
				})
			}
			this.#sink.onDone?.()
		} catch (err) {
			if (this.#abort?.signal.aborted) {
				// Interrupted. The assistant turn still has to go into the history,
				// even half-finished: the stream threw before `#round` could record
				// it, which would leave two user turns back to back — the malformed
				// shape that makes this model start improvising around the hole.
				this.#wire.push({
					role: 'assistant',
					content: reply.content || '(unterbrochen)'
				})
				if (reply.content === '') this.turns = this.turns.filter((t) => t.id !== replyId)
			} else {
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

	/**
	 * One request/response. Streams any prose into `reply` and returns the tool
	 * calls the model asked for, which the caller runs before going round again.
	 */
	async #round(reply: Turn): Promise<{ id: string; name: string; arguments: string }[]> {
		let content = ''
		// Keyed by the index the model assigns, since fragments interleave.
		const calls = new Map<number, { id: string; name: string; arguments: string }>()

		for await (const event of streamChat(
			this.#wire,
			this.#tools.specs,
			this.#abort?.signal ?? undefined
		)) {
			if (event.kind === 'text') {
				content += event.text
				reply.content += event.text
				this.#sink.onDelta?.(event.text)
				continue
			}

			const call = calls.get(event.index) ?? { id: '', name: '', arguments: '' }
			if (event.id) call.id = event.id
			if (event.name) call.name = event.name
			// Arguments stream in as JSON fragments and are only valid concatenated.
			if (event.args) call.arguments += event.args
			calls.set(event.index, call)
		}

		const asked = [...calls.values()].filter((c) => c.name !== '')
		// Never an empty assistant turn: a blank message is another way to get a
		// blank reply out of this model.
		this.#wire.push({
			role: 'assistant',
			content:
				content || (asked.length > 0 ? `Ich rufe ${asked.map((c) => c.name).join(', ')} auf.` : '…')
		})
		return asked
	}

	/** Stop mid-reply. Whatever has arrived so far stays on screen. */
	stop(): void {
		this.#abort?.abort()
	}

	clear(): void {
		this.stop()
		this.turns = []
		this.#wire = [{ role: 'system', content: SYSTEM_PROMPT }]
		this.failure = null
	}
}
