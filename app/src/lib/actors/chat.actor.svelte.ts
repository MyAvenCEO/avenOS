import { Chat } from '$lib/chat/chat.svelte'
import { complete, extractJsonObject } from '$lib/chat/redpill'
import type { Activity } from './activity.svelte'
import { activity } from './activity.svelte'
import { Actor } from './actor'
import { bus } from './bus'
import { catalog } from './catalog'
import { LlmActor } from './llm.actor'
import { NegotiatorActor } from './negotiator.actor'
import { RegistryActor } from './registry.actor'
import { singleton } from './singleton'
import { isWindow } from './window.actor.svelte'
import { WorkItemsActor, workItems } from './workitems.svelte'

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
					if (name === 'send') {
						const inner =
							payload.payload && typeof payload.payload === 'object'
								? (payload.payload as Record<string, unknown>)
								: {}
						const result = await bus.dispatch('chat', String(payload.method ?? ''), {
							...inner,
							to: payload.to
						})
						activity.show(summarizeCall(String(payload.method ?? ''), result.record))
						return result
					}
					if (name === 'actor_ask') {
						const answer = await bus.ask(
							String(payload.actor ?? ''),
							String(payload.question ?? ''),
							'chat'
						)
						const result = {
							record: JSON.stringify({ ok: true, actor: payload.actor, answer }),
							wire: answer
						}
						activity.show(summarizeCall(name, result.record))
						return result
					}
					const result = await bus.dispatch('chat', name, payload)
					// A drafted bridge takes the stage: the review gate must be SEEN,
					// not hunted for — same single-active rule as every window.
					if (name === 'negotiate') {
						try {
							if ((JSON.parse(result.record) as { ok?: boolean }).ok) {
								for (const other of bus.actors()) {
									if (isWindow(other)) other.open = false
								}
								const gate = bus.get('negotiator-window')
								if (gate && isWindow(gate)) gate.open = true
							}
						} catch {
							// unreadable result stages nothing
						}
					}
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
// The model as a service ACTOR (0130): the mesh reaches the model only by
// message to `llm`, and this transport is the single client of the server
// proxy — model default, sampling, and JSON mode have one home.
export const llmActor = singleton(
	'aven.llm',
	() =>
		new LlmActor((system, question, settings) =>
			complete(
				[
					{ role: 'system', content: system },
					{ role: 'user', content: question }
				],
				{
					// Default lane = the fast voice model; a manifest's own llm
					// settings override it per actor.
					model: settings?.model ?? 'qwen/qwen3.5-122b-a10b',
					temperature: settings?.temperature,
					json: settings?.json
				}
			)
		)
)
bus.register(llmActor)
bus.extractJson = extractJsonObject

bus.register(workItems)
// The task list may exist many times — "make me a list for the move" spawns
// a fresh instance with its own sandbox state and windows.
bus.spawnable('workitem', () => new WorkItemsActor())
/**
 * The catalog, live: every manifest declared in code joins the mesh at boot
 * — registered before the chat actor so the derived tool list carries them
 * from the first turn. The codebase is the source of truth. Reactive here
 * (not in the base): windows re-render when the sandbox reduces.
 */
class ReactiveActor extends Actor {
	state = $state<Record<string, unknown>>({})
}
export const catalogActors = catalog.map((manifest) =>
	singleton(`aven.actor.${manifest.id}`, () => new ReactiveActor(manifest))
)
for (const actor of catalogActors) bus.register(actor)
/** The Negotiator (0131): drafts bridges between incompatible actors, HITL-gated. */
class ReactiveNegotiator extends NegotiatorActor {
	state = $state<Record<string, unknown>>({})
}
export const negotiatorActor = singleton('aven.negotiator', () => new ReactiveNegotiator(bus))
bus.register(negotiatorActor)
export const registryActor = singleton('aven.registry', () => new RegistryActor(bus))
bus.register(registryActor)
export const chatActor = singleton('aven.chat', () => new ChatActor())
bus.register(chatActor)
