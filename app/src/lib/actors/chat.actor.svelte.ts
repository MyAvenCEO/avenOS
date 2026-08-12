import { Chat } from '$lib/chat/chat.svelte'
import { complete, extractJsonObject } from '$lib/chat/redpill'
import type { Activity } from './activity.svelte'
import { activity } from './activity.svelte'
import { Actor } from './actor'
import { bus } from './bus'
import { catalog } from './catalog'
import { RecordActor } from './created.actor.svelte'
import { RegistryActor } from './registry.actor'
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
				'The conversation: takes utterances, thinks with the model, calls tools ' +
				'over the bus, and streams the reply out sentence by sentence.',
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
				// A getter, not a snapshot: the registry grows at runtime (created
				// actors, their windows), and a list frozen at construction would
				// hide every late arrival from the model — which is exactly how
				// "zeig den Kalender" once had no tool to call.
				get specs() {
					return bus.toolSpecs().map(({ name, description, parameters }) => ({
						name,
						description,
						parameters
					}))
				},
				run: async (name, args) => {
					let payload: Record<string, unknown> = {}
					try {
						payload = args.trim() === '' ? {} : JSON.parse(args)
					} catch {
						const record = JSON.stringify({ ok: false, error: `unreadable arguments: ${args}` })
						return { record, wire: 'unreadable arguments' }
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
			turns: this.core.turns.length,
			streaming: this.core.streaming ? 'yes' : 'no',
			model: 'qwen3.5-122b-a10b'
		}
	}

	protected override situation(): string {
		return `${this.core.turns.length} turns so far${this.core.streaming ? ', replying right now' : ''}.`
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
	if (name.endsWith('_window_toggle')) {
		try {
			const parsed = JSON.parse(record)
			return {
				kind: 'switched',
				titles: [],
				note: `window ${String(parsed.window ?? '').replace(/-window$/, '')} ${parsed.open ? 'on' : 'off'}`
			}
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
// Over the RAW lane, deliberately: the prose stream strips braces as
// anti-glitch armor, but ask() answers survive that fine while llm-actor
// EXECUTION returns JSON that must arrive intact. Fast model — this lane
// sits in the voice loop's latency budget.
bus.llm = (system, question, settings) =>
	complete(
		[
			{ role: 'system', content: system },
			{ role: 'user', content: question }
		],
		{
			// Default lane = the fast voice model; a manifest's own llm settings
			// override it — an actor may pin its own model in its manifest.
			model: settings?.model ?? 'qwen/qwen3.5-122b-a10b',
			temperature: settings?.temperature,
			json: (settings as { json?: boolean } | undefined)?.json
		}
	)
bus.extractJson = extractJsonObject

bus.register(workItems)
/**
 * The catalog, live: every manifest declared in code becomes a RecordActor —
 * it executes through the model and remembers what it produced. Registered
 * before the chat actor so the derived tool list carries them from the first
 * turn. The codebase is the source of truth; only the records are stored.
 */
export const catalogActors = catalog.map((manifest) =>
	singleton(`aven.actor.${manifest.id}`, () => new RecordActor(manifest, bus))
)
for (const actor of catalogActors) bus.register(actor)
export const registryActor = singleton('aven.registry', () => new RegistryActor(bus))
bus.register(registryActor)
export const chatActor = singleton('aven.chat', () => new ChatActor())
bus.register(chatActor)
