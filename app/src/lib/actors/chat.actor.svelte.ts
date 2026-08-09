import { Chat } from '$lib/chat/chat.svelte'
import { streamChat } from '$lib/chat/redpill'
import type { Activity } from './activity.svelte'
import { activity } from './activity.svelte'
import { Actor } from './actor'
import { bus } from './bus'
import { singleton } from './singleton'
import { workItems } from './workitems.svelte'

/**
 * The brain as an actor. The conversation machinery (streaming, tool rounds,
 * degeneration guards) stays in Chat; the wrapper puts it on the mesh:
 *
 * - in: utterance(T) from the listener, interrupted() for barge-in
 * - out: delta(D) while the reply streams, reply(R) when it is done,
 *   discard(R) when a tool round unsays the placeholder
 * - sideways: tool calls become envelopes on the bus, specs derived from the
 *   registry — register an actor and the model can call it.
 */
export class ChatActor extends Actor {
	readonly core: Chat

	constructor() {
		super({
			id: 'chat',
			name: 'Chat',
			description:
				'Das Gespräch: nimmt Äußerungen entgegen, denkt mit dem Modell, ruft Werkzeuge ' +
				'über den Bus auf und streamt die Antwort satzweise hinaus.',
			tags: ['voice', 'todo'],
			methods: [],
			requires: ['utterance(T)', 'interrupted()'],
			produces: ['delta(D)', 'reply(R)', 'discard(R)']
		})

		this.core = new Chat(
			{
				onDelta: (text) => {
					void bus.emit('delta(D)', { text }, 'chat')
				},
				onDone: () => {
					void bus.emit('reply(R)', {}, 'chat')
				},
				// Tool calls mean the real answer is still coming; unsay the placeholder.
				onRestart: () => {
					void bus.emit('discard(R)', {}, 'chat')
				}
			},
			{
				specs: bus.toolSpecs().map(({ name, description, parameters }) => ({
					name,
					description,
					parameters
				})),
				run: async (name, args) => {
					let payload: Record<string, unknown> = {}
					try {
						payload = args.trim() === '' ? {} : JSON.parse(args)
					} catch {
						const record = JSON.stringify({ ok: false, error: `unlesbare Argumente: ${args}` })
						return { record, wire: 'unlesbare Argumente' }
					}
					if (name === 'actor_ask') {
						const answer = await bus.ask(
							String(payload.actor ?? ''),
							String(payload.question ?? '')
						)
						const result = {
							record: JSON.stringify({ ok: true, actor: payload.actor, answer }),
							wire: answer
						}
						activity.show(summarizeCall(name, result.record))
						return result
					}
					const result = await bus.dispatch('chat', name, payload)
					activity.show(summarizeCall(name, result.record))
					return result
				}
			}
		)

		this.bind({
			// Not awaited: a turn runs long, and the mailbox must stay free for
			// the barge-in that interrupts it.
			utterance: (p) => {
				void this.core.send(String(p.text ?? ''))
				return { record: '{"ok":true}', wire: 'ok' }
			},
			interrupted: () => {
				this.core.stop()
				return { record: '{"ok":true}', wire: 'ok' }
			}
		})
	}

	override instanceState(): Record<string, unknown> {
		return {
			Turns: this.core.turns.length,
			streamt: this.core.streaming ? 'ja' : 'nein',
			Modell: 'qwen3.5-122b-a10b'
		}
	}

	protected override situation(): string {
		return `${this.core.turns.length} Turns bisher${this.core.streaming ? ', antwortet gerade' : ''}.`
	}
}

/** One displayable entry for a call — the owning actor knows its own words. */
export function summarizeCall(name: string, record: string): Omit<Activity, 'id'> | null {
	if (name === 'actor_ask') {
		try {
			const parsed = JSON.parse(record)
			return { kind: 'asked', titles: [String(parsed.actor ?? '')] }
		} catch {
			return null
		}
	}
	return workItems.summarize(name, record)
}

/**
 * Registration and the one LLM, in dependency order: work items first so the
 * chat's derived tool list contains them, the pipeline actors after.
 */
bus.llm = async (system, question) => {
	let text = ''
	for await (const event of streamChat(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: question }
		],
		[]
	)) {
		if (event.kind === 'text') text += event.text
	}
	return text
}

bus.register(workItems)
export const chatActor = singleton('aven.chat', () => new ChatActor())
bus.register(chatActor)
