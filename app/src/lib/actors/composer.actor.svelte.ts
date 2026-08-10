import { complete } from '$lib/chat/redpill'
import { Actor, type Manifest } from './actor'
import type { MessageBus } from './bus'
import { RegistryActor } from './registry.actor'

/**
 * The composer as a full actor — no longer a hidden seam inside the registry.
 *
 * It designs actors: a wish comes in, a manifest draft comes out, and only an
 * explicit commit registers it. The staged pipeline is deliberate and VISIBLE:
 * the composer's own window (its face) renders every stage — wish received,
 * model drafting, draft ready for review, registered and live — so creating an
 * actor stops being a silent tool call and becomes a flow you can watch and
 * steer, by voice or by button.
 *
 * Dogfooding the per-actor model lane: this manifest declares its OWN llm
 * settings (kimi, low temperature) and its handlers execute over exactly that
 * declared lane — the same mechanism every created llm actor uses.
 */

export type ComposerStage = 'idle' | 'drafting' | 'draft' | 'registering' | 'live' | 'failed'

export interface ComposerStep {
	at: number
	label: string
	ok: boolean
}

export class ComposerActor extends Actor {
	stage = $state<ComposerStage>('idle')
	wish = $state('')
	draft = $state<Manifest | null>(null)
	steps = $state<ComposerStep[]>([])
	/** The model's live deliberation, streamed while it drafts — the face shows it. */
	thinking = $state('')
	/** How much answer text has arrived after the deliberation, in characters. */
	writing = $state(0)

	/** UI seam: called when the flow starts, so the face can take the stage. */
	onStage?: () => void

	#bus: MessageBus

	constructor(bus: MessageBus) {
		super({
			id: 'composer',
			name: 'Composer',
			description:
				'Designs new actors from spoken wishes: drafts a manifest with a stronger ' +
				'model, shows it for review, and registers it on commit — a visible, ' +
				'staged flow instead of a silent create.',
			tags: ['system'],
			produces: ['manifest(M)'],
			llm: { model: 'moonshotai/kimi-k3', temperature: 0.3 },
			methods: [
				{
					name: 'composer_draft',
					description:
						'Starts the actor-creation flow: drafts a manifest from a freeform wish. ' +
						'The Composer window opens and shows the draft for review — nothing is ' +
						'registered yet. Use this whenever someone wants a new actor.',
					parameters: {
						type: 'object',
						properties: {
							wish: { type: 'string', description: 'Freeform: what the new actor should do.' }
						},
						required: ['wish']
					},
					produces: ['manifest(M)']
				},
				{
					name: 'composer_revise',
					description:
						'Reworks the current draft with a freeform change instruction — the ' +
						'window updates. Only valid while a draft is showing.',
					parameters: {
						type: 'object',
						properties: {
							instruction: {
								type: 'string',
								description: 'Freeform: what about the draft should be different.'
							}
						},
						required: ['instruction']
					}
				},
				{
					name: 'composer_commit',
					description:
						'Registers the reviewed draft as a real actor — it joins the mesh, gets ' +
						'its own window, and survives restarts. Call when the user approves.',
					parameters: { type: 'object', properties: {} }
				},
				{
					name: 'composer_discard',
					description: 'Throws the current draft away and resets the flow.',
					parameters: { type: 'object', properties: {} }
				}
			]
		})
		this.#bus = bus
		this.bind({
			composer_draft: (p) => this.#draft(p),
			composer_revise: (p) => this.#revise(p),
			composer_commit: () => this.#commit(),
			composer_discard: () => this.#discard()
		})
	}

	#note(label: string, ok = true): void {
		this.steps.push({ at: Date.now(), label, ok })
	}

	/** This actor's declared lane — the same one the engine would use. */
	#lane() {
		return typeof this.manifest.llm === 'object' ? this.manifest.llm : {}
	}

	async #design(user: string): Promise<Manifest | null> {
		const taken = this.#bus.actors().map((a) => a.manifest.id)
		this.thinking = ''
		this.writing = 0
		// Throttled: kimi streams dozens of reasoning tokens a second, and one
		// $state write per token would burn the UI thread for nothing.
		let pendingReasoning = ''
		let lastFlush = 0
		const flush = () => {
			if (pendingReasoning !== '') {
				this.thinking = (this.thinking + pendingReasoning).slice(-4000)
				pendingReasoning = ''
			}
			lastFlush = Date.now()
		}
		const answer = await complete(
			[
				{ role: 'system', content: RegistryActor.composerSystem(taken) },
				{ role: 'user', content: user }
			],
			{
				...this.#lane(),
				onDelta: (delta) => {
					if (delta.reasoning) {
						pendingReasoning += delta.reasoning
						if (Date.now() - lastFlush > 120) flush()
					}
					if (delta.text) this.writing += delta.text.length
				}
			}
		)
		flush()
		const bare = answer.replace(/^[\s\S]*?(\{[\s\S]*\})[\s\S]*?$/, '$1')
		try {
			const parsed = JSON.parse(bare)
			if (
				parsed &&
				typeof parsed === 'object' &&
				typeof parsed.id === 'string' &&
				typeof parsed.name === 'string' &&
				typeof parsed.description === 'string'
			) {
				return parsed as Manifest
			}
		} catch {
			// fall through to null — the caller words the failure
		}
		return null
	}

	async #draft(p: Record<string, unknown>) {
		const wish = String(p.wish ?? '').trim()
		if (wish === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'no wish' }),
				wire: 'The wish is missing.'
			}
		}
		this.onStage?.()
		this.stage = 'drafting'
		this.wish = wish
		this.draft = null
		this.steps = []
		this.#note(`wish received: "${wish}"`)
		this.#note('drafting with kimi-k3 — reasoning models take their time…')

		const manifest = await this.#design(`Design a new actor. Wish: ${wish}`)
		if (!manifest) {
			this.stage = 'failed'
			this.#note('the model returned no readable manifest', false)
			return {
				record: JSON.stringify({ ok: false, error: 'no readable manifest' }),
				wire: 'The draft failed — the model returned no readable manifest.'
			}
		}
		this.draft = manifest
		this.stage = 'draft'
		this.thinking = ''
		this.#note(
			`draft ready: ${manifest.id} — ${(manifest.requires ?? []).join(', ') || 'nothing'} → ${(manifest.produces ?? []).join(', ') || 'nothing'}`
		)
		return {
			record: JSON.stringify({ ok: true, draft: manifest }),
			wire:
				`Draft ready: ${manifest.name} (${manifest.id}) — ${manifest.description} ` +
				'It is showing in the Composer window. Say commit to register it, or describe changes.'
		}
	}

	async #revise(p: Record<string, unknown>) {
		const instruction = String(p.instruction ?? '').trim()
		if (!this.draft || instruction === '') {
			return {
				record: JSON.stringify({ ok: false, error: 'no draft or no instruction' }),
				wire: 'There is no draft to revise, or the instruction is missing.'
			}
		}
		this.onStage?.()
		this.stage = 'drafting'
		this.#note(`revising: "${instruction}"`)
		const manifest = await this.#design(
			`Rework this manifest draft: ${JSON.stringify(this.draft)}. Requested change: ${instruction}`
		)
		if (!manifest) {
			this.stage = 'draft'
			this.#note('revision failed — keeping the previous draft', false)
			return {
				record: JSON.stringify({ ok: false, error: 'revision failed' }),
				wire: 'The revision failed; the previous draft still stands.'
			}
		}
		this.draft = manifest
		this.stage = 'draft'
		this.thinking = ''
		this.#note(`draft revised: ${manifest.id}`)
		return {
			record: JSON.stringify({ ok: true, draft: manifest }),
			wire: `Draft revised: ${manifest.name}. Commit to register it, or keep changing.`
		}
	}

	async #commit() {
		if (!this.draft) {
			return {
				record: JSON.stringify({ ok: false, error: 'no draft' }),
				wire: 'There is no draft to commit.'
			}
		}
		this.stage = 'registering'
		this.#note(`registering ${this.draft.id}`)
		// The registry stays the one place actors are registered and persisted —
		// the composer merely hands over the reviewed manifest, as a message.
		const result = await this.#bus.dispatch('composer', 'actor_create', { manifest: this.draft })
		let ok = true
		try {
			ok = JSON.parse(result.record).ok !== false
		} catch {
			// non-JSON counts as fine
		}
		this.stage = ok ? 'live' : 'failed'
		this.#note(ok ? `${this.draft.id} is live, window and all` : `registration failed`, ok)
		return result
	}

	#discard() {
		this.stage = 'idle'
		this.wish = ''
		this.draft = null
		this.#note('draft discarded')
		return {
			record: JSON.stringify({ ok: true }),
			wire: 'The draft is discarded.'
		}
	}

	override instanceState(): Record<string, unknown> {
		return {
			stage: this.stage,
			wish: this.wish || '—',
			draft: this.draft?.id ?? '—',
			lane: typeof this.manifest.llm === 'object' ? (this.manifest.llm.model ?? 'default') : '—'
		}
	}

	protected override situation(): string {
		return `Stage ${this.stage}${this.draft ? `, draft ${this.draft.id}` : ''}; drafting on my own kimi lane.`
	}
}
