import { type ChatMessage, repairCall, streamChat, type ToolSpec } from './redpill'

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
	'You are avenOS, a terse and direct assistant. You answer questions of every ' +
	'kind freely and naturally — knowledge, explanations, ideas, short texts — ' +
	'like any good assistant; you need no tools for that. ' +
	'Always answer in the language the user speaks, in plain flowing prose with ' +
	'no markdown, lists or emojis — your reply is read out loud. ' +
	'Your first sentence is always very short, five words at most, ending with a ' +
	'period. Everything else follows in the sentences after it. ' +
	"You also keep the user's task list. Only when the topic is tasks do the " +
	'tool rules apply: act immediately — call the tools in the same turn you ' +
	'learn of a change, and multiple tasks always in one single call. ' +
	'After the tools, answer the human like in a conversation: briefly say how ' +
	'things stand now. Never talk about tools, ids, confirmations or actions; ' +
	'ids are internal and never read out. ' +
	'Every task is its own entry with a short title — never append several ' +
	'things to an existing title. "Four healthy ingredients" means four separate ' +
	'tasks you think up yourself. ' +
	'Tasks are addressed by their id, never by title — call todo_list ' +
	'before you change, delete, or talk about the list. ' +
	'Every task belongs to exactly one spark, the spark context: "me" for ' +
	'personal things, "team" for shared ones. Without a mention, the active ' +
	'spark applies; "for the team" means spark=team. ' +
	'Tasks have three statuses: open, in_progress, done. When someone says a ' +
	'thing is finished, call todo_update with status=done; "just starting" ' +
	'means status=in_progress. Deleting happens only on explicit request. Read ' +
	'lists out as flowing prose. ' +
	'Exactly one window is on screen at a time; switch with the *_window_toggle ' +
	'tools and open=true — the previous window disappears by itself. "Show the ' +
	'list" means list_window_toggle, "show the board" means board_window_toggle ' +
	'— each with open=true. todo_show only switches the spark. All of these ' +
	'are view changes, never data changes. ' +
	'Call registry_list when you are unsure which actors exist. ' +
	'Destructive actions are HELD: the call returns held=..., a bar appears ' +
	'for the human, and only their button press executes it. Say that you ' +
	'have prepared it and the user must press Confirm. ' +
	'Messages come from speech recognition and are sometimes cut off ' +
	'mid-sentence. If a message reads like the continuation of the previous ' +
	'one, treat both together as one request. ' +
	'When you call tools, write no text in the same turn — your answer comes ' +
	'once you have the results, and then in one piece.'

/**
 * Hard stop on tool rounds, so a model that keeps calling cannot loop forever.
 *
 * Deleting everything finished takes list, then one delete per item, then the
 * answer — and four rounds ran out partway, leaving whatever the last round had
 * written as the final reply. That is how "Ich rufe todo_delete, todo_delete…
 * auf." ended up on screen as an answer while nothing was deleted.
 */
const MAX_TOOL_ROUNDS = 8

/**
 * A reply that has stopped being language.
 *
 * Twenty consecutive characters with no letter and no digit do not occur in
 * German prose; they are the model stuck in a punctuation loop (streams of `}`
 * were the observed shape). Checked against the tail as the reply streams.
 */
const DEGENERATE = /[^\p{L}\p{Nd}]{20}$/u

/** What to shave off a reply cut short by the degeneration guard. */
const TRAILING_JUNK = /[^\p{L}\p{Nd}]+$/u

/**
 * A reply that claims or promises list work.
 *
 * Qwen's failure mode is the polite deferral — "Habe ich notiert.", "Ich lege
 * nun die Aufgabe an." — prose in place of a tool call, with the list
 * untouched. A reply matching this in a round that called no tools is not
 * accepted: the model is told once to execute, and only what comes back after
 * that stands.
 */
const CLAIMS_ACTION =
	/notier|hinzugefügt|hinzufüg|angelegt|aktualisiert|gelöscht|abgehakt|markiert|eingetragen|erstellt|registriert|erschaffen|steht auf|stehen auf|auf der liste|auf deiner liste|von der liste|ist jetzt sichtbar|wird angezeigt|ist jetzt auf dem bildschirm|ist jetzt zu sehen|wird geöffnet|is now (visible|shown|on screen)|\bich (füge|lege|trage|erstelle|kümmere|werde)\b|\badded\b|\bcreated\b|\bdeleted\b|\bremoved\b|\bupdated\b|\bchecked off\b|\bmarked\b|\bnoted\b|\bis on (the|your) list\b|\bare on (the|your) list\b|\bI('ll| will| have|'ve)? (add|create|delete|remove|update|take care)\b/i

const NUDGE =
	'You called no tool — nothing happened on the list. ' +
	'Execute the change with the tools now, without text.'

/**
 * The other collapse: a whole sentence repeated verbatim, on and on —
 * "Lerne ich deine Aufgaben. Was ist zu tun?" six times in a row. Letters
 * throughout, so the junk guard cannot see it. If the last 32 characters
 * already appear at least twice earlier in the reply, the model is looping;
 * everything from the second occurrence on is noise.
 */
function loopStart(content: string): number {
	if (content.length < 96) return -1
	const gram = content.slice(-32)
	const first = content.indexOf(gram)
	if (first === -1 || first >= content.length - 64) return -1
	const second = content.indexOf(gram, first + 1)
	return second !== -1 && second < content.length - 32 ? second : -1
}

export interface Turn {
	id: string
	role: 'user' | 'assistant'
	content: string
	/** Every tool call this turn ran, with its result, for the transcript. */
	calls?: { name: string; result: string }[]
}

/** Hooks for anything that wants the reply as it arrives — the speaker, today. */
export interface ChatSink {
	onDelta?: (text: string) => void
	onDone?: () => void
	/** The turn is starting over after tool calls — drop what was said so far. */
	onRestart?: () => void
	/** A turn boundary: a bubble was pushed or the log cleared — re-render. */
	onTurn?: () => void
}

export interface ChatTools {
	specs: ToolSpec[]
	/**
	 * Run one call. `record` is the machine-readable result, kept on the turn
	 * for the transcript; `wire` is what the model reads back — the two differ
	 * because the model gets prose where the transcript wants structure. May be
	 * async: the ask() path consults an LLM.
	 */
	run: (
		name: string,
		args: string
	) => { record: string; wire: string } | Promise<{ record: string; wire: string }>
}

let nextId = 0
const id = () => `t${nextId++}`

/** One conversation: what a person sees, and what the model saw. */
interface Session {
	turns: Turn[]
	wire: ChatMessage[]
}

export class Chat {
	turns = $state<Turn[]>([])
	streaming = $state(false)
	failure = $state<string | null>(null)
	/**
	 * Which conversation `turns` currently shows. The chat is scoped per
	 * intent: every intent has its own session stream, and selecting an
	 * intent switches to it (`use`). Sessions are kept in memory for the
	 * lifetime of the chat; a reply in flight keeps writing into the session
	 * it started in, even if the view has moved on.
	 */
	session = $state('')
	#sessions = new Map<string, Session>()

	// The system prompt is NOT stored here — it is prepended per request, so a
	// long-lived singleton Chat always speaks with the current prompt instead
	// of whatever was compiled in when the instance was born.
	#wire: ChatMessage[] = []
	#abort: AbortController | null = null
	#sink: ChatSink
	#tools: ChatTools

	constructor(
		sink: ChatSink = {},
		tools: ChatTools = { specs: [], run: () => ({ record: '', wire: '' }) }
	) {
		this.#sink = sink
		this.#tools = tools
	}

	get canSend(): boolean {
		return !this.streaming
	}

	/** Switch the visible conversation to `key`, creating it on first use. */
	use(key: string): void {
		if (key === this.session) return
		this.#sessions.set(this.session, { turns: this.turns, wire: this.#wire })
		const next = this.#sessions.get(key) ?? { turns: [], wire: [] }
		this.session = key
		this.turns = next.turns
		this.#wire = next.wire
		this.failure = null
		this.#sink.onTurn?.()
	}

	/**
	 * The live turn's abort signal — the REPLY scope only. Long-running work
	 * (long-running work) deliberately hangs on the separate work signal
	 * in the actor wiring: barge-in fires on any voice activity and must not
	 * kill a design run.
	 */
	get signal(): AbortSignal | undefined {
		return this.#abort?.signal
	}

	async send(text: string): Promise<void> {
		const prompt = text.trim()
		if (prompt === '' || this.streaming) return

		this.failure = null
		// Pinned for the whole turn: `use()` may swap the visible session while
		// the reply streams, and the reply must land where it was asked.
		const turns = this.turns
		const wire = this.#wire
		turns.push({ id: id(), role: 'user', content: prompt })
		wire.push({ role: 'user', content: prompt })

		// Push first, then take the reference back OUT of the array. `turns` is a
		// `$state` proxy: it hands out a proxied view on read, and only writes
		// through that view are tracked. Holding on to the object literal we
		// pushed and mutating it would update the data and tell no one — the
		// reply would stream into a bubble that never re-renders.
		const replyId = id()
		turns.push({ id: replyId, role: 'assistant', content: '', calls: [] })
		const reply = turns[turns.length - 1]
		const dropStub = () => {
			const at = turns.findIndex((t) => t.id === replyId)
			if (at >= 0) turns.splice(at, 1)
		}

		this.streaming = true
		this.#sink.onTurn?.()
		this.#abort = new AbortController()

		try {
			let nudged = false
			for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
				const calls = await this.#round(reply, wire)
				if (calls.length === 0) {
					// Said it did something, called nothing — in the WHOLE turn. The
					// round alone is the wrong scope: the natural closing sentence
					// after a successful tool round ("Fenster öffnen ist abgehakt.")
					// names the action too, and bouncing that accused the model of
					// lying right after it did the work — to which it answered ever
					// more defensively ("wurde bereits ausgeführt, wie die IDs
					// zeigen"). Only a turn that ran nothing at all gets the nudge.
					if (!nudged && (reply.calls?.length ?? 0) === 0 && CLAIMS_ACTION.test(reply.content)) {
						nudged = true
						reply.content = ''
						this.#sink.onRestart?.()
						wire.push({ role: 'user', content: NUDGE })
						continue
					}
					break
				}

				// Anything said before calling a tool was a placeholder — "Alles klar,
				// mache ich." — and the real answer comes in the next round. Keeping
				// both meant two spoken responses per turn and one bubble with both
				// jammed together, so the placeholder is dropped from the bubble and
				// unsaid by the speaker.
				if (reply.content !== '') {
					reply.content = ''
					this.#sink.onRestart?.()
				}

				// One tool message per call, addressed by id — the format the model's
				// own template expects, so nothing here reads as conversation.
				for (const call of calls) {
					const result = await this.#tools.run(call.name, call.arguments)
					reply.calls?.push({ name: call.name, result: result.record })
					wire.push({ role: 'tool', tool_call_id: call.id, content: result.wire })
				}
			}
			this.#sink.onDone?.()
		} catch (err) {
			if (this.#abort?.signal.aborted) {
				// Interrupted. The assistant turn still has to go into the history,
				// even half-finished: the stream threw before `#round` could record
				// it, which would leave two user turns back to back — the malformed
				// shape that makes this model start improvising around the hole.
				wire.push({
					role: 'assistant',
					content: reply.content || '(unterbrochen)'
				})
				if (reply.content === '') dropStub()
			} else {
				this.failure = err instanceof Error ? err.message : String(err)
				// Drop the stub rather than leaving an empty bubble behind. A reply
				// that got partway through is kept — it is still worth reading.
				if (reply.content === '') dropStub()
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
	async #round(
		reply: Turn,
		wire: ChatMessage[]
	): Promise<{ id: string; name: string; arguments: string }[]> {
		let content = ''
		// Keyed by the index the model assigns, since fragments interleave.
		const calls = new Map<number, { id: string; name: string; arguments: string }>()

		for await (const event of streamChat(
			[{ role: 'system', content: SYSTEM_PROMPT }, ...wire],
			this.#tools.specs,
			this.#abort?.signal ?? undefined
		)) {
			if (event.kind === 'text') {
				content += event.text
				reply.content += event.text
				this.#sink.onDelta?.(event.text)
				// The model sometimes collapses into emitting punctuation forever —
				// `}` after `}` after `}` — and would keep going for its whole output
				// budget. No German sentence has thirty-two straight characters
				// without a letter or digit, so that tail is the collapse itself:
				// stop the stream, cut the junk, and let what was said stand.
				const looped = loopStart(content)
				if (DEGENERATE.test(content) || looped !== -1) {
					content = (looped !== -1 ? content.slice(0, looped) : content).replace(TRAILING_JUNK, '')
					reply.content = content
					break
				}
				continue
			}

			const call = calls.get(event.index) ?? { id: '', name: '', arguments: '' }
			if (event.id) call.id = event.id
			if (event.name) call.name = event.name
			// Arguments stream in as JSON fragments and are only valid concatenated.
			if (event.args) call.arguments += event.args
			calls.set(event.index, call)
		}

		// Repaired before anything reads the name: this model sometimes writes the
		// whole call into the name field as Python.
		// Repaired before anything reads the name, and with ids guaranteed —
		// the tool results reference their call by id.
		const asked = [...calls.values()]
			.filter((c) => c.name !== '')
			.map(repairCall)
			.map((c, i) => ({ ...c, id: c.id || `call_${i}` }))

		// The turn goes into the history exactly as the model made it: prose in
		// content, calls in tool_calls. The synthetic fillers of the Gemma era
		// ("Ich rufe X auf.", a bare "…") each ended up imitated as answers —
		// what sits here is what the model learns a reply looks like.
		wire.push({
			role: 'assistant',
			content,
			...(asked.length > 0 && {
				tool_calls: asked.map((c) => ({
					id: c.id,
					type: 'function' as const,
					function: { name: c.name, arguments: c.arguments }
				}))
			})
		})
		return asked
	}

	/**
	 * The whole conversation as one JSON document, for pasting into a debugging
	 * session.
	 *
	 * `wire` is the part that matters: the exact messages the model saw and
	 * produced — system prompt, tool_calls with their raw arguments, tool
	 * results by id. The rendered `turns` ride along so the human-visible side
	 * (including what the stream guards cut) can be compared against it.
	 */
	export(): unknown {
		return {
			wire: [{ role: 'system', content: SYSTEM_PROMPT }, ...this.#wire],
			turns: this.turns,
			failure: this.failure
		}
	}

	/** Stop mid-reply. Whatever has arrived so far stays on screen. */
	stop(): void {
		this.#abort?.abort()
	}

	clear(): void {
		this.stop()
		this.turns = []
		this.#wire = []
		this.failure = null
		this.#sink.onTurn?.()
	}
}
